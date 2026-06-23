export interface Env {
  TRACKING_EVENTS_QUEUE: any;
  INTERNAL_API_KEY?: string;
}

const rateLimiter = new Map<string, { count: number; expiresAt: number }>();

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    try {
      const url = new URL(request.url);
      const isGet = request.method === "GET";
      const isPost = request.method === "POST";

      if (!isGet && !isPost) {
        return new Response(JSON.stringify({ status: "error", message: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" }
        });
      }

      let prospectId: string | null = null;
      let event: string | null = null;

      if (isPost) {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.split(" ")[1] !== env.INTERNAL_API_KEY) {
          return new Response(JSON.stringify({ status: "error", message: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
        }
        const body = await request.json() as any;
        prospectId = body.prospectId;
        event = body.event;
      } else {
        prospectId = url.searchParams.get("prospectId");
        event = url.searchParams.get("event");
      }

      const pixelGif = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);

      if (!prospectId || !event) {
        return new Response(pixelGif.buffer, {
          status: 200,
          headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" }
        });
      }

      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      const rateKey = `${ip}-${prospectId}`;
      const now = Date.now();
      const rateRecord = rateLimiter.get(rateKey) ?? { count: 0, expiresAt: now + 3600000 };

      if (now > rateRecord.expiresAt) {
        rateRecord.count = 0;
        rateRecord.expiresAt = now + 3600000;
      }

      if (rateRecord.count >= 5) {
        return new Response(pixelGif.buffer, {
          status: 200,
          headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" }
        });
      }

      rateRecord.count++;
      rateLimiter.set(rateKey, rateRecord);

      if (env.TRACKING_EVENTS_QUEUE) {
        await env.TRACKING_EVENTS_QUEUE.send({
          prospectId,
          event,
          timestamp: new Date().toISOString(),
          ip
        });
      }

      return new Response(pixelGif.buffer, {
        status: 200,
        headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" }
      });
    } catch {
      return new Response(null, { status: 204 });
    }
  }
};
