package com.noctgram.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Outline
import android.graphics.SurfaceTexture
import android.graphics.drawable.AnimatedImageDrawable
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.os.Build
import android.provider.Settings
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import androidx.annotation.RequiresApi
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * «Анимации аватаров и обводок» on this device, as on the site. Off as well
 * when the system removes animations; the switch cannot override that.
 */
object MotionPreference {
    private const val FILE = "noctgram-settings"
    private const val KEY = "avatar-motion"
    private var system = true
    var chosen by mutableStateOf(true)
        private set
    val enabled get() = system && chosen

    fun load(context: Context) {
        system = runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f }
            .getOrDefault(true)
        chosen = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(KEY, true)
    }

    fun choose(context: Context, value: Boolean) {
        chosen = value
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(KEY, value).apply()
    }

    /** True when the system itself asks for less motion, so the switch is shown off and locked. */
    val systemReduced get() = !system
}

/**
 * Animated avatars are files of up to 10 MB that need the session cookie, so
 * they are downloaded once into the app's cache and played from there.
 */
object MotionCache {
    private fun folder(context: Context) = File(context.cacheDir, "motion").apply { mkdirs() }

    suspend fun file(context: Context, api: NoctApi, url: String): File = withContext(Dispatchers.IO) {
        val name = url.substringAfterLast('/').filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(80)
        require(name.isNotEmpty())
        val file = File(folder(context), name)
        if (!file.isFile || file.length() == 0L) {
            val part = File(folder(context), "$name.part")
            part.writeBytes(api.download(url, 10 * 1024 * 1024 + 1))
            part.renameTo(file)
        }
        file
    }

    /** Another account must never see what the previous one cached. */
    fun clear(context: Context) {
        File(context.cacheDir, "motion").deleteRecursively()
    }
}

/**
 * The avatar in motion: [still] is drawn first and stays when the file cannot
 * be played, is still loading, or animations are off.
 */
@Composable
fun MotionFace(api: NoctApi, url: String, type: String, size: Dp, still: @Composable () -> Unit) {
    val context = LocalContext.current
    val preview = LocalInspectionMode.current
    val file by produceState<File?>(null, url) {
        if (!preview) value = runCatching { MotionCache.file(context, api, url) }.getOrNull()
    }
    Box(Modifier.size(size).clip(CircleShape), contentAlignment = Alignment.Center) {
        still()
        val ready = file
        if (ready != null && MotionPreference.enabled) when {
            type == "image/gif" && Build.VERSION.SDK_INT >= 28 -> GifFace(ready)
            type.startsWith("video/") -> VideoFace(ready)
        }
    }
}

@RequiresApi(28)
@Composable
private fun GifFace(file: File) {
    val animated = remember(file) {
        runCatching { ImageDecoder.decodeDrawable(ImageDecoder.createSource(file)) }.getOrNull() as? AnimatedImageDrawable
    } ?: return
    DisposableEffect(animated) {
        animated.repeatCount = AnimatedImageDrawable.REPEAT_INFINITE
        animated.start()
        onDispose { animated.stop() }
    }
    // The drawable advances by itself; asking for a frame each vsync redraws it while it is shown.
    val frame by produceState(0L) { while (true) withFrameNanos { value = it } }
    Canvas(Modifier.fillMaxSize()) {
        frame
        val width = animated.intrinsicWidth.coerceAtLeast(1)
        val height = animated.intrinsicHeight.coerceAtLeast(1)
        val scale = maxOf(size.width / width, size.height / height)
        drawIntoCanvas { canvas ->
            val native = canvas.nativeCanvas
            native.save()
            native.translate((size.width - width * scale) / 2, (size.height - height * scale) / 2)
            native.scale(scale, scale)
            animated.setBounds(0, 0, width, height)
            animated.draw(native)
            native.restore()
        }
    }
}

/** A muted, looping video cut to a circle, like the site's <video> avatar. */
@Composable
private fun VideoFace(file: File) {
    // One holder for the whole life of the view, so the release below sees the live player.
    val slot = remember { PlayerSlot() }
    AndroidView(
        factory = { context ->
            val texture = TextureView(context)
            texture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
                    slot.player = runCatching {
                        MediaPlayer().apply {
                            setDataSource(file.path)
                            setSurface(Surface(surface))
                            isLooping = true
                            setVolume(0f, 0f)
                            setOnVideoSizeChangedListener { _, w, h -> texture.centerCrop(w, h) }
                            setOnPreparedListener { it.start() }
                            prepareAsync()
                        }
                    }.getOrNull()
                }
                override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = Unit
                override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
                    slot.release()
                    return true
                }
                override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit
            }
            FrameLayout(context).apply {
                clipToOutline = true
                outlineProvider = object : ViewOutlineProvider() {
                    override fun getOutline(view: View, outline: Outline) = outline.setOval(0, 0, view.width, view.height)
                }
                addView(texture, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            }
        },
        onRelease = { slot.release() },
        modifier = Modifier.fillMaxSize(),
    )
}

private class PlayerSlot {
    var player: MediaPlayer? = null
    fun release() {
        player?.release()
        player = null
    }
}

private fun TextureView.centerCrop(videoWidth: Int, videoHeight: Int) {
    if (videoWidth == 0 || videoHeight == 0 || width == 0 || height == 0) return
    val scale = maxOf(width.toFloat() / videoWidth, height.toFloat() / videoHeight)
    setTransform(Matrix().apply { setScale(videoWidth * scale / width, videoHeight * scale / height, width / 2f, height / 2f) })
}

/**
 * The still frame the site stores next to an animated avatar: the first frame
 * of the GIF or video, cut to a square and saved as JPEG.
 */
fun posterOf(context: Context, file: PickedFile): ByteArray? {
    val frame = when {
        file.mime == "image/gif" -> BitmapFactory.decodeByteArray(file.bytes, 0, file.bytes.size)
        file.mime.startsWith("video/") -> {
            val temporary = File.createTempFile("motion", ".video", context.cacheDir)
            try {
                temporary.writeBytes(file.bytes)
                val retriever = MediaMetadataRetriever()
                try {
                    retriever.setDataSource(temporary.path)
                    retriever.getFrameAtTime(0)
                } finally {
                    retriever.release()
                }
            } catch (_: Exception) {
                null
            } finally {
                temporary.delete()
            }
        }
        else -> null
    } ?: return null
    val side = minOf(frame.width, frame.height)
    val square = Bitmap.createBitmap(frame, (frame.width - side) / 2, (frame.height - side) / 2, side, side)
    val target = minOf(side, 512)
    val scaled = Bitmap.createScaledBitmap(square, target, target, true)
    return ByteArrayOutputStream().use {
        scaled.compress(Bitmap.CompressFormat.JPEG, 90, it)
        it.toByteArray()
    }
}
