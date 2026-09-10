export type ExportPage = {
  rows: Record<string, unknown>[];
  next: string | null;
};
export type ExportSection = {
  name: string;
  page: (after: string) => Promise<ExportPage>;
};

// Backpressure keeps at most one database page in memory. Cancelling a download
// closes the generator so it cannot keep querying the rest of the account.
export function accountExport(
  metadata: Record<string, unknown>,
  sections: ExportSection[],
) {
  async function* chunks() {
    const head = JSON.stringify(metadata);
    yield head.slice(0, -1);
    let separator = Object.keys(metadata).length ? ',' : '';
    for (const section of sections) {
      yield `${separator}${JSON.stringify(section.name)}:[`;
      separator = ',';
      let after = '',
        first = true;
      while (true) {
        const page = await section.page(after);
        if (page.rows.length) {
          yield (
            (first ? '' : ',') +
              page.rows.map((row) => JSON.stringify(row)).join(',')
          );
          first = false;
        }
        if (page.next === null) break;
        if (page.next <= after) throw new Error('Invalid export cursor');
        after = page.next;
      }
      yield ']';
    }
    yield '}';
  }
  const iterator = chunks(),
    encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await iterator.next();
        if (chunk.done) controller.close();
        else controller.enqueue(encoder.encode(chunk.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="noctgram-account.json"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
