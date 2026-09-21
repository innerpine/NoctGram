'use client';
// gl.useProgram() is WebGL, not a React hook.
/* eslint-disable react/react-compiler */
import { useEffect, useRef } from 'react';

// «Жидкое»: the avatar, blurred into a small texture and slowly warped by
// simplex noise. Ported from the profile mock-up; the noise is sampled in
// banner-aspect space so the blobs stay round on a wide cover.
const TEXTURE = 192,
  BLUR = 8,
  WIDTH = 360,
  HEIGHT = 96;
const VERTEX = `attribute vec2 position;varying vec2 uv;void main(){uv=position*0.5+0.5;gl_Position=vec4(position,0.0,1.0);}`;
const FRAGMENT = `
precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform float time;
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
  vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
  m=m*m;m=m*m;vec3 x=2.0*fract(p*C.www)-1.0;vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;return 130.0*dot(m,g);
}
void main(){
  float t=time*0.055;
  vec2 p=uv*vec2(${(WIDTH / HEIGHT / 2).toFixed(2)},1.0);
  vec2 q=vec2(snoise(p+vec2(0.0,t)),snoise(p+vec2(5.2,1.3+t)));
  vec2 r=vec2(snoise(p*1.3+2.2*q+vec2(1.7,9.2+t*0.7)),snoise(p*1.3+2.2*q+vec2(8.3,2.8+t*0.6)));
  vec3 color=texture2D(tex,clamp(uv+0.12*r,0.0,1.0)).rgb;
  /* a soft vignette instead of the mock-up's tight ellipse: the banner stays filled */
  float d=length(uv-0.5)*2.0;
  float edge=exp(-0.9*d*d);
  float dither=fract(dot(gl_FragCoord.xy,vec2(0.7548776662,0.5698402909)))-0.5;
  gl_FragColor=vec4(color+dither/255.0,edge+dither/255.0);
}`;

export function LiquidCover({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !src) return;
    let live = true,
      stop = () => {};
    const image = new Image();
    image.src = src;
    void image
      .decode()
      .then(() => {
        if (!live) return;
        const texture = document.createElement('canvas');
        texture.width = texture.height = TEXTURE;
        const blurred = texture.getContext('2d');
        if (!blurred) return;
        blurred.filter = `blur(${BLUR}px)`;
        // Overscan so the blur never pulls transparent edges into the picture.
        blurred.drawImage(image, -18, -18, TEXTURE + 36, TEXTURE + 36);
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        const gl = canvas.getContext('webgl', {
          alpha: true,
          antialias: false,
          depth: false,
          stencil: false,
          powerPreference: 'low-power',
        });
        if (!gl) {
          // No WebGL: the still, blurred avatar is a fair stand-in.
          canvas.getContext('2d')?.drawImage(texture, 0, 0, WIDTH, HEIGHT);
          canvas.dataset.ready = 'true';
          return;
        }
        const shader = (type: number, source: string) => {
          const s = gl.createShader(type)!;
          gl.shaderSource(s, source);
          gl.compileShader(s);
          return s;
        };
        const program = gl.createProgram()!;
        gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 3, -1, -1, 3]),
          gl.STATIC_DRAW,
        );
        const position = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        for (const [name, value] of [
          [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
          [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
          [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
          [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
        ])
          gl.texParameteri(gl.TEXTURE_2D, name, value);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          texture,
        );
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.viewport(0, 0, WIDTH, HEIGHT);
        const time = gl.getUniformLocation(program, 'time');
        const draw = (seconds: number) => {
          gl.uniform1f(time, seconds);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        draw(0);
        canvas.dataset.ready = 'true';
        // Browsers cap live WebGL contexts, so give this one back on unmount.
        const release = () =>
          gl.getExtension('WEBGL_lose_context')?.loseContext();
        stop = release;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
          return;
        let frame = 0,
          started = 0,
          elapsed = 0,
          running = false;
        const loop = (now: number) => {
          if (!running) return;
          draw(elapsed + (now - started) / 1000);
          frame = requestAnimationFrame(loop);
        };
        // Animate only while the banner is on screen.
        const watcher = new IntersectionObserver(([entry]) => {
          if (entry.isIntersecting && !running) {
            running = true;
            started = performance.now();
            frame = requestAnimationFrame(loop);
          } else if (!entry.isIntersecting && running) {
            elapsed += (performance.now() - started) / 1000;
            running = false;
            cancelAnimationFrame(frame);
          }
        });
        watcher.observe(canvas);
        stop = () => {
          running = false;
          cancelAnimationFrame(frame);
          watcher.disconnect();
          release();
        };
      })
      .catch(() => {
        /* A broken avatar simply leaves the plain cover. */
      });
    return () => {
      live = false;
      stop();
    };
  }, [src]);
  // The key gives every avatar a fresh canvas: a context cannot be reused after loseContext().
  return (
    <canvas key={src} ref={ref} className="liquid-cover" aria-hidden="true" />
  );
}
