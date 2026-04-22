export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        };
        if (request.method === "OPTIONS") { return new Response(null, { status: 204, headers: corsHeaders }); }

        function unescapeHtml(value) {
            if (!value) return null;
            return value
                .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
                .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
                .replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({
                    'amp': '&',
                    'lt': '<',
                    'gt': '>',
                    'quot': '"',
                    '#39': "'"
                }[e]));
        }
        function extractMeta(buffer, name) {
            const escape = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");;
            const match = buffer.match(new RegExp(`<meta[^>]+(?:property|name)=["']?${escape}(?=["'\\s>])["']?[^>]*?content=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))[^>]*>|<meta[^>]+content=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))[^>]*?(?:property|name)=["']?${escape}(?=["'\\s>])["']?[^>]*>`, "i"));
            if (!match) return null;
            return unescapeHtml(match[1] || match[2] || match[3] || match[4] || match[5] || match[6] || null);
        }
        const cacheKey = new Request(request.url, { method: "GET" });
        const cache = caches.default;
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        const parameters = new URL(request.url).searchParams;
        const url = parameters.get("url");
        const raw = parameters.get("raw") === "true";
        if (!url) return new Response(JSON.stringify({ error: "Missing URL" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
        if (!/^https?:\/\//i.test(url)) return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
        let target;
        try { target = new URL(url); }
        catch { return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }); }
        if (request.headers.get("host") == target.hostname) return new Response(JSON.stringify({ error: "Blocked" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
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
                    "User-Agent": "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com/)",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                    "Accept-Encoding": "identity",
                    "Connection": "keep-alive",
                    "Upgrade-Insecure-Requests": "1"
                }
            });
        }
        catch { return new Response(JSON.stringify({ error: "Fetch failed" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }); }
        if (Number(upstream.headers.get("content-length")) > 500_000) return new Response(JSON.stringify({ error: "File too large" }), { status: 413, headers: { "Content-Type": "application/json", ...corsHeaders } });
        const contentType = upstream.headers.get("content-type") || "";
        if (!raw && !contentType.includes("text/html")) return new Response(JSON.stringify({ error: "Unsupported Content Type" }), { status: 415, headers: { "Content-Type": "application/json", ...corsHeaders } });
        const charsetMatch = contentType.match(/charset=([^;]+)/i);
        const reader = upstream.body.pipeThrough(new TextDecoderStream(charsetMatch ? charsetMatch[1] : "utf-8")).getReader();
        let buffer = "";
        let headContent = "";
        let capturingHead = false;
        let META_PRIORITY = {
            title: ["og:title", "twitter:title", "title"],
            description: ["og:description", "twitter:description", "description"],
            image: ["og:image", "og:image:secure_url", "og:image:url", "twitter:image"],
            video: ["og:video", "og:video:secure_url", "og:video:url"],
            site: ["og:site_name", "twitter:site"],
            theme: ["theme-color", "msapplication-TileColor"]
        };
        const PRIORITY_OVERRIDE = {
            "reddit.com": {
                title: ["title", "og:title", "twitter:title"],
                description: ["description", "og:description", "twitter:description"]
            }
        };
        const metaState = {};
        for (const domain in PRIORITY_OVERRIDE) {
            if (target.hostname.endsWith(domain)) {
                const override = PRIORITY_OVERRIDE[domain];
                for (const key in override) {
                    META_PRIORITY[key] = override[key];
                }
            }
        }
        function tryExtract(field, type, buffer) {
            const value = extractMeta(buffer, type);
            if (!value) return;
            const priority = META_PRIORITY[field].indexOf(type);
            const current = metaState[field];
            if (!current || priority < current.priority) metaState[field] = { value, priority };
        }
        const isFinished = () => metaState.site && metaState.title && metaState.description && metaState.image && metaState.video && metaState.theme;
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
                            headContent = buffer.substring(start.index);
                        }
                    }
                    else headContent += value;
                    if (capturingHead && /<\/head>/i.test(headContent)) {
                        const end = headContent.search(/<\/head>/i);
                        headContent = headContent.substring(0, end + "</head>".length);
                        controller.abort();
                        break;
                    }
                }
                else {
                    tryExtract("site", "og:site_name", buffer);
                    tryExtract("site", "twitter:site", buffer);
                    tryExtract("title", "og:title", buffer);
                    tryExtract("title", "twitter:title", buffer);
                    tryExtract("title", "title", buffer);
                    const titleTag = buffer.match(/<title[^>]*>(.*?)<\/title>/i);
                    if (titleTag) {
                        const priority = META_PRIORITY.title.indexOf("title");
                        const current = metaState.title;
                        if (!current || priority < current.priority) metaState.title = { value: titleTag[1].trim(), priority };
                    }
                    tryExtract("description", "og:description", buffer);
                    tryExtract("description", "twitter:description", buffer);
                    tryExtract("description", "description", buffer);
                    tryExtract("image", "og:image", buffer);
                    tryExtract("image", "og:image:secure_url", buffer);
                    tryExtract("image", "og:image:url", buffer);
                    tryExtract("image", "twitter:image", buffer);
                    if (metaState.image && !metaState.image.value.startsWith("http")) metaState.image.value = new URL(metaState.image.value, target.origin).href
                    tryExtract("video", "og:video", buffer);
                    tryExtract("video", "og:video:secure_url", buffer);
                    tryExtract("video", "og:video:url", buffer);
                    if (metaState.video && !metaState.video.value.startsWith("http")) metaState.video.value = new URL(metaState.video.value, target.origin).href
                    tryExtract("theme", "theme-color", buffer);
                    tryExtract("theme", "msapplication-TileColor", buffer);
                    if (buffer.includes("</head>") || isFinished()) {
                        controller.abort();
                        break;
                    }
                    if (buffer.length > 100000 && metaState.title && metaState.description) {
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
        if (raw) response = new Response(headContent, { headers: { "Content-Type": "text/plain; charset=UTF-8", "Cache-Control": "public, max-age=86400", ...corsHeaders } });
        else response = new Response(JSON.stringify({
            title: metaState.title?.value || null,
            description: metaState.description?.value || null,
            image: metaState.image?.value || null,
            video: metaState.video?.value || null,
            site: metaState.site?.value || null,
            theme: metaState.theme?.value || null
        }), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400", ...corsHeaders } });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
    }
};