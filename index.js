export default {
    async fetch(request, env, ctx) {
        function extractMeta(buffer, name) {
            const escape = name.replace(/:/g, "[:]");
            const match = buffer.match(new RegExp(`<meta[^>]+(?:property|name)=["']?${escape}["']?[^>]+content=(?:"([^"]+)"|'([^']+)'|([^\\s>]+))[^>]*>|<meta[^>]+content=(?:"([^"]+)"|'([^']+)'|([^\\s>]+))[^>]+(?:property|name)=["']?${escape}["']?[^>]*>`, "i"));
            if (!match) return null;
            return match[1] || match[2] || match[3] || match[4] || match[5] || match[6] || null;
        }

        const cacheKey = new Request(request.url, { method: "GET" });
        const cache = caches.default;

        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        const parameters = new URL(request.url).searchParams;
        const url = parameters.get("url");
        const raw = parameters.get("raw") === "true";
        const firefoxUA = parameters.get("discord") === "false";

        if (!url) return new Response(JSON.stringify({ error: "Missing URL" }), { status: 400, headers: { "Content-Type": "application/json" } });

        if (!/^https?:\/\//i.test(url)) return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400, headers: { "Content-Type": "application/json" } });

        let target;
        try { target = new URL(url); }
        catch { return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400, headers: { "Content-Type": "application/json" } }); }

        if (request.headers.get("host") == target.hostname) return new Response(JSON.stringify({ error: "Blocked" }), { status: 400, headers: { "Content-Type": "application/json" } });

        const controller = new AbortController();
        const signal = controller.signal;
        const timeout = setTimeout(() => controller.abort(), 10000);

        let upstream;
        try {
            upstream = await fetch(target.toString(), {
                method: "GET",
                redirect: "follow",
                signal,
                cf: { scrapeShield: false },
                headers: {
                    "User-Agent": firefoxUA ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0" : "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com/)",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                    "Accept-Encoding": "identity",
                    "Connection": "keep-alive",
                    "Upgrade-Insecure-Requests": "1"
                }
            });
        }
        catch { return new Response(JSON.stringify({ error: "Fetch failed" }), { status: 500, headers: { "Content-Type": "application/json" } }); }

        if (Number(upstream.headers.get("content-length")) > 500_000) return new Response(JSON.stringify({ error: "File too large" }), { status: 413, headers: { "Content-Type": "application/json" } });
        const contentType = upstream.headers.get("content-type") || "";
        if (!raw && !contentType.includes("text/html")) return new Response(JSON.stringify({ error: "Unsupported Content Type" }), { status: 415, headers: { "Content-Type": "application/json" } });

        const charsetMatch = contentType.match(/charset=([^;]+)/i);
        const reader = upstream.body.pipeThrough(new TextDecoderStream(charsetMatch ? charsetMatch[1] : "utf-8")).getReader();

        let buffer = "";
        let headContent = "";
        let capturingHead = false;

        let site = null;
        let title = null;
        let description = null;
        let image = null;
        let theme = null;

        const isFinished = () => site && title && description && image && theme;

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += value;
                if (buffer.length > 20000) buffer = buffer.slice(-10000);

                if (raw) {
                    if (!capturingHead) {
                        const start = buffer.match(/<head[^>]*>/i);
                        if (start) {
                            capturingHead = true;
                            headContent = buffer.slice(start.index);
                        }
                    }
                    else headContent += value;
                    if (capturingHead && /<\/head>/i.test(headContent)) {
                        controller.abort();
                        break;
                    }
                }
                else {
                    if (!site) site = extractMeta(buffer, "og:site_name");
                    if (!site) site = extractMeta(buffer, "twitter:site");
                    if (!title) title = extractMeta(buffer, "og:title");
                    if (!title) title = extractMeta(buffer, "twitter:title");
                    if (!title) title = extractMeta(buffer, "title");
                    if (!title) {
                        const meta = buffer.match(/<title[^>]*>(.*?)<\/title>/i);
                        if (meta) title = meta[1].trim();
                    }
                    if (!description) description = extractMeta(buffer, "og:description");
                    if (!description) description = extractMeta(buffer, "twitter:description");
                    if (!description) description = extractMeta(buffer, "description");
                    if (!image) image = extractMeta(buffer, "og:image");
                    if (!image) image = extractMeta(buffer, "twitter:image");
                    if (image && !image.startsWith("http")) image = new URL(image, target.origin + target.pathname).href;

                    if (!theme) theme = extractMeta(buffer, "theme-color");

                    if (buffer.includes("</head>") || isFinished()) {
                        controller.abort();
                        break;
                    }
                    if (buffer.length > 100000 && title && description) {
                        controller.abort();
                        break;
                    }
                }
                
                if (buffer.length > 200000) {
                    controller.abort();
                    break;
                }
            }
        } catch { }

        clearTimeout(timeout);

        let response;

        if (raw) response = new Response(headContent, { headers: { "Content-Type": "text/plain; charset=UTF-8", "Access-Control-Allow-Origin": "https://slchat.alwaysdata.net", "Cache-Control": "public, max-age=86400" } });
        else response = new Response(JSON.stringify({ site, title, description, image, theme }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "https://slchat.alwaysdata.net", "Cache-Control": "public, max-age=86400" } });

        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
    }
};