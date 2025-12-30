export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        if (!['GET', 'HEAD'].includes(request.method)) {
            return new Response('Method Not Allowed', { status: 405 });
        }

        const url = new URL(request.url);
        const key = url.pathname.slice(1);

        const range = request.headers.get('Range');
        const isRange = !!range;

        const cache = caches.default;

        const cacheKey = new Request(url.toString(), { method: "GET" });

        if (!isRange) {
            const cached = await cache.match(cacheKey);
            if (cached) {
                return cached;
            }
        }

        const object = await env.R2.get(key, {
            range: range || undefined,
        });

        if (!object) {
            return new Response("Not Found", { status: 404 });
        }

        const etag = object.etag;
        const ifNoneMatch = request.headers.get("If-None-Match");

        if (!isRange && ifNoneMatch === etag) {
            return new Response(null, {
                status: 304,
                headers: {
                    "ETag": etag,
                    "Cache-Control": "public, max-age=31536000, immutable",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);

        headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
        headers.set("ETag", etag);
        headers.set("Accept-Ranges", "bytes");
        headers.set(
            "Cache-Control",
            "public, max-age=31536000, stale-while-revalidate=86400, immutable"
        );
        headers.set("Access-Control-Allow-Origin", "*");

        if (!isRange && object.size !== undefined) {
            headers.set("Content-Length", object.size.toString());
        }

        const response = new Response(
            request.method === "HEAD" ? null : object.body,
            {
                status: object.range ? 206 : 200,
                headers,
            }
        );

        if (!isRange && request.method === "GET" && response.status === 200) {
            ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }

        return response;
    }
} satisfies ExportedHandler<Env>;
