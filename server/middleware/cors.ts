export default defineEventHandler((event) => {
    const origin = getHeader(event, "origin") || "";

    // Autoriser tous les mondes Grepolis (ex: fr176.grepolis.com)
    const isGrepolis = /^https:\/\/\w+\d+\.grepolis\.com$/i.test(origin);

    if (isGrepolis) {
        setHeader(event, "Access-Control-Allow-Origin", origin);
        setHeader(event, "Vary", "Origin");
    }

    setHeader(event, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    setHeader(event, "Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (event.method === "OPTIONS") {
        event.node.res.statusCode = 204;
        event.node.res.end();
    }
});
