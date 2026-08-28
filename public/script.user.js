// ==UserScript==
// @name         Grepolis Temple Notifier
// @namespace    http://tampermonkey.net/
// @version      2026.2.0
// @description  Monitors the incoming support and attacks on temples
// @author       Jos
// @match        http://*.grepolis.com/game/*
// @match        https://*.grepolis.com/game/*
// @exclude      view-source://*
// @exclude      https://classic.grepolis.com/game/*
// @icon         https://cdn-icons-png.flaticon.com/512/3874/3874511.png
// @updateURL    https://kuroros-projects.vercel.app/script.meta.js
// @downloadURL  https://kuroros-projects.vercel.app/script.user.js
// @homepage     https://kuroros-projects.vercel.app
// @grant		 GM_getValue
// @grant		 GM_setValue
// @grant        unsafeWindow
// @require		 https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js
// ==/UserScript==

/*******************************************************************************************************************************
 * Global stuff
 *******************************************************************************************************************************/

var uw = unsafeWindow || window;
var $ = uw.jQuery;

const BASE_URL = "https://kuroros-projects.vercel.app";

let OLYMPUS_HOOK = null;
let SUPPORT_HOOK = null;

// ======================================
const settings = {
    send_support_message: true,
    send_attack_message: true,
    discord_support_hook: "",
    discord_attack_hook: "",
    monitor_timeout: 300000,
};

const language = {
    settings: {
        title: "Temple Notifier Settings",
        settings: "Settings",
        send_support_message: "Send support message to Discord",
        send_attack_message: "Send attack message to Discord",
        discord_support_hook: "Discord webhook URL for support messages",
        discord_attack_hook: "Discord webhook URL for attack messages",
        monitor_timeout: "Intervalle de scan en millisecondes (min 30000 = 30s, par défaut 300000 = 5min)",
        save_reload: "Save and reload",
        credits:
            "Made by Jos, please contact me with suggestions or bugs and to add support for your language.",
    },
};
// ======================================

/*******************************************************************************************************************************
 * ALLIANCE MAPPING — labels + webhooks par alliance du joueur courant
 *******************************************************************************************************************************/

const ALLIANCE_LABEL_BY_ID = {
    420: "[REPROD] Finir comme Carlos",
    121: "[OFF TER] huit-neuf",
    856: "[OFF NAV/LADONS] Bienveillance Max",
    833: "[DEF] Bim Bam Boum",
    209: "[PORTAIL 1] Bo Zinnc Supremacyx",
    118: "[PORTAIL 2] - UNSC -"
};

function getAllianceLabel(id) {
    if (!id) return "Sans alliance";
    return ALLIANCE_LABEL_BY_ID[id] || `Alliance #${id}`;
}

let HOOKS_BY_ALLIANCE_ID = {};

const DEFAULT_HOOKS = {
    support: null,
    attack:  null,
};

function getHooksForCurrentAlliance() {
    const allianceId = uw.Game?.alliance_id;
    return HOOKS_BY_ALLIANCE_ID[allianceId] || DEFAULT_HOOKS;
}

/*******************************************************************************************************************************
 * WHITELIST — joueurs dont les mouvements ne déclenchent PAS de notification
 *******************************************************************************************************************************/

let WHITELISTED_PLAYERS = [];

function isPlayerWhitelisted(playerName) {
    return WHITELISTED_PLAYERS.some(
        name => name.toLowerCase() === (playerName || "").toLowerCase()
    );
}

/*******************************************************************************************************************************
 * Client-side movement cache — évite les appels Vercel redondants
 * TTL 24h, nettoyage automatique, max 1000 entrées
 *******************************************************************************************************************************/

const SEEN_TTL_SECONDS = 24 * 60 * 60;

function _loadSeenCache() {
    try {
        return JSON.parse(GM_getValue("gtn_seen_movements", "{}"));
    } catch {
        return {};
    }
}

function isMovementSeen(movementId) {
    const cache = _loadSeenCache();
    const ts = cache[String(movementId)];
    if (!ts) return false;
    return (Date.now() / 1000) - ts < SEEN_TTL_SECONDS;
}

function markMovementSeen(movementId) {
    const cache = _loadSeenCache();
    const now = Math.floor(Date.now() / 1000);
    cache[String(movementId)] = now;

    for (const id of Object.keys(cache)) {
        if (now - cache[id] >= SEEN_TTL_SECONDS) delete cache[id];
    }

    const keys = Object.keys(cache);
    if (keys.length > 1000) {
        keys.sort((a, b) => cache[a] - cache[b]);
        for (const id of keys.slice(0, keys.length - 1000)) delete cache[id];
    }

    GM_setValue("gtn_seen_movements", JSON.stringify(cache));
}

unsafeWindow.GTN = {
    cache:       () => JSON.parse(GM_getValue("gtn_seen_movements", "{}")),
    clearCache:  () => { GM_setValue("gtn_seen_movements", "{}"); console.log("[GTN] cache vidé"); },
    forceExpire: (id) => {
        const c = JSON.parse(GM_getValue("gtn_seen_movements", "{}"));
        if (id) { c[String(id)] = 1; }
        else { for (const k of Object.keys(c)) c[k] = 1; }
        GM_setValue("gtn_seen_movements", JSON.stringify(c));
        console.log("[GTN] expiré :", id || "tous");
    },
    forceScan: async () => {
        if (isScanning) { console.log("[GTN] scan déjà en cours"); return; }
        isScanning = true;
        try { await getTempleMovements(); } catch(e) { console.error(e); } finally { isScanning = false; }
    },
    settings: () => settings,
};
console.log("[GTN] GTN helpers dispo → GTN.cache() / GTN.clearCache() / GTN.forceExpire(id) / GTN.forceScan() / GTN.settings()");

/*******************************************************************************************************************************
 * Main
 *******************************************************************************************************************************/

async function loadConfig() {
    try {
        const response = await fetch(`${BASE_URL}/api/config`);
        if (!response.ok) throw new Error(`Config error: ${response.status}`);
        const config = await response.json();

        OLYMPUS_HOOK = config.olympusHook || null;
        HOOKS_BY_ALLIANCE_ID = config.hooksByAlliance || {};
        WHITELISTED_PLAYERS = config.whitelistedPlayers || [];

        console.log("[GTN] config loaded ✅", { alliances: Object.keys(HOOKS_BY_ALLIANCE_ID).length, whitelist: WHITELISTED_PLAYERS.length });
    } catch (e) {
        console.error("[GTN] failed to load config:", e);
    }
}

(async function () {
    "use strict";
    console.log(
        "%c|= " +
        GM.info.script.name +
        " is active v" +
        GM.info.script.version +
        " (" +
        GM.info.scriptHandler +
        " v" +
        GM.info.version +
        ") =|",
        "color: cyan; font-size: 1em; font-weight: bolder; "
    );

    addSettingsButton();
    loadSettings();
    await loadConfig();

    setTimeout(() => {
        monitor();
    }, 1000);
})();

function addSettingsButton() {
    if (document.getElementById("GTNSettingsButton") == null) {
        var button = document.createElement("div");
        button.id = "GTNSettingsButton";
        button.className = "btn_settings circle_button";
        var img = document.createElement("div");
        img.style.margin = "6px 0px 0px 5px";
        img.style.background =
            "url(https://cdn-icons-png.flaticon.com/512/3874/3874511.png) no-repeat 0px 0px";
        img.style.width = "22px";
        img.style.height = "22px";
        img.style.backgroundSize = "100%";
        button.style.top = "145px";
        button.style.right = "108px";
        button.style.zIndex = "10000";
        button.appendChild(img);
        document.getElementById("ui_box").appendChild(button);

        $("#GTNSettingsButton").click(createSettingsWindow);
    }
}

function loadSettings() {
    settings.send_support_message = GM_getValue("setting_send_support_message", settings.send_support_message);
    settings.send_attack_message = GM_getValue("setting_send_attack_message", settings.send_attack_message);
    settings.discord_support_hook = GM_getValue("setting_discord_support_hook", settings.discord_support_hook);
    settings.discord_attack_hook = GM_getValue("setting_discord_attack_hook", settings.discord_attack_hook);

    const mt = GM_getValue("setting_monitor_timeout", settings.monitor_timeout);
    settings.monitor_timeout = Number(mt);

    if (!Number.isFinite(settings.monitor_timeout) || settings.monitor_timeout < 30000) {
        settings.monitor_timeout = 30000;
    }
}

let isScanning = false;
let monitorTimer = null;

async function monitor() {
    const base = Number(settings.monitor_timeout) || 60000;
    if (monitorTimer) clearTimeout(monitorTimer);
    monitorTimer = setTimeout(monitor, base + Math.random() * 5000);

    if (isScanning) {
        console.log("[GTN] skip tick (scan still running)");
        return;
    }

    if (!window.location.hostname.includes("fr184")) {
        console.log("[GTN] serveur non supporté :", window.location.hostname, "→ skip");
        return;
    }

    isScanning = true;
    console.log("[GTN] tick", new Date().toLocaleTimeString(), "townId=", uw.Game?.townId);

    try {
        await getTempleMovements();
    } catch (error) {
        console.error("[GTN] monitor error:", error);
    } finally {
        isScanning = false;
    }
}

function dts(ts) { return ts ? `<t:${ts}:T>` : "?"; }
function drel(ts) { return ts ? `<t:${ts}:R>` : "?"; }

async function getTempleMovements() {
    const templeCommands = await fetchTempleCommands();

    const activeTemples = templeCommands.filter(
        c => c.count_supports > 0 || c.count_attacks > 0
    );

    if (activeTemples.length === 0) {
        console.log("[GTN] no active temples, scan finished ✅");
        return;
    }

    const templeDataList = await Promise.all(
        activeTemples.map(cmd => fetchTempleData(cmd.temple_id))
    );

    console.log(`[GTN] ${activeTemples.length} temples actifs fetchés`);

    const hooks = getHooksForCurrentAlliance();
    const allyLabel = getAllianceLabel(uw.Game?.alliance_id);

    for (let i = 0; i < activeTemples.length; i++) {
        const command = activeTemples[i];
        const movements = templeDataList[i]?.movements || [];

        for (const movement of movements) {
            if (isMovementSeen(movement.id)) continue;

            const isSupportType = ["support", "portal_support_olympus"].includes(movement.type);

            if (isSupportType && isPlayerWhitelisted(movement.sender_name)) {
                markMovementSeen(movement.id);
                continue;
            }

            if (isSupportType && !settings.send_support_message) {
                markMovementSeen(movement.id);
                continue;
            }
            if (!isSupportType && !settings.send_attack_message) {
                markMovementSeen(movement.id);
                continue;
            }

            console.log(`[GTN] nouveau mvt ${movement.id} | type=${movement.type} | sender=${movement.sender_name}`);

            try {
                console.log(`[GTN] → Vercel mvt ${movement.id}`);
                const data = await createTempleMovement(
                    movement.id,
                    command.temple_id,
                    movement.sender_name || "Inconnu",
                    movement.origin_town_name || "Inconnu",
                    movement.type,
                    movement.started_at,
                    movement.arrival_at
                );

                console.log(`[GTN] ← Vercel mvt ${movement.id} success=${data?.success}`);
                markMovementSeen(movement.id);

                if (!data?.success) continue;

                const typeLabel =
                    movement.type === "support"                ? "SOUTIEN" :
                    movement.type === "portal_support_olympus" ? "SOUTIEN PORTAIL" :
                    movement.type === "portal_attack_olympus"  ? "ATT PORTAIL" :
                    movement.type === "attack_sea"             ? "OFF NAV" :
                    movement.type === "attack_takeover"        ? "BC" :
                    movement.type === "attack_land"            ? "UMV" :
                    "MOUVEMENT";

                const typeEmoji =
                    movement.type === "support"                ? "🛡️" :
                    movement.type === "portal_support_olympus" ? "🔵" :
                    movement.type === "portal_attack_olympus"  ? "⚡" :
                    movement.type === "attack_sea"             ? "⚓" :
                    movement.type === "attack_takeover"        ? "👑" :
                    movement.type === "attack_land"            ? "⚔️" :
                    "🔵";

                const color =
                    movement.type === "support"                ? 0x2ECC71 :
                    movement.type === "portal_support_olympus" ? 0x3498DB :
                    movement.type === "portal_attack_olympus"  ? 0xE74C3C :
                    movement.type === "attack_sea"             ? 0xE74C3C :
                    movement.type === "attack_land"            ? 0xFF69B4 :
                    movement.type === "attack_takeover"        ? 0xF1C40F :
                    0x95A5A6;

                const ping =
                    movement.type === "attack_takeover" ? "@everyone" : null;

                const embed = {
                    title: `${typeEmoji} ${typeLabel} — ${movement.destination_town_name || "Temple"}`,
                    color: color,
                    fields: [
                        { name: "🏛️ Temple",   value: `[temple]${command.temple_id}[/temple]`,  inline: true },
                        { name: "🦶 Alliance", value: `**${allyLabel}**`,                       inline: true },
                        { name: "👤 Joueur",   value: movement.sender_name || "Inconnu",        inline: true },
                        { name: "📍 Origine",  value: movement.origin_town_name || "Inconnu",   inline: true },
                        { name: "⏳ Départ",   value: `${dts(movement.started_at)} (${drel(movement.started_at)})`,   inline: true },
                        { name: "🎯 Arrivée",  value: `${dts(movement.arrival_at)} (${drel(movement.arrival_at)})`,  inline: true },
                    ],
                    footer: { text: `🔍 Détecté par ${uw.Game?.player_name || "?"}` },
                    timestamp: new Date().toISOString(),
                };

                const isPortalType = movement.type === "portal_support_olympus" || movement.type === "portal_attack_olympus";
                const hook = isPortalType ? OLYMPUS_HOOK : (isSupportType ? (hooks.support || hooks.attack) : hooks.attack);
                await sendToDiscord(hook, embed, ping);

            } catch (e) {
                console.warn("[GTN] movement error", movement.id, e);
            }
        }
    }

    console.log("[GTN] scan finished ✅");
}

async function fetchTempleData(templeId) {
    const payload = {
        action_name: "read",
        model_url: "TempleInfo",
        arguments: { target_id: templeId },
    };

    var result = undefined;
    await gpAjax.ajaxGet("frontend_bridge", "execute", payload, !0, {
        success: function (da, U) { result = U; },
        error: function (da, U) { console.error("[GTN] fetchTempleData error", da, U); },
    });

    return result;
}

async function fetchTempleCommands() {
    const payload = {
        types: [{ type: "backbone" }],
        town_id: Game.townId,
        nl_init: false,
    };

    var result = undefined;
    await gpAjax.ajaxPost("game/data", "get", payload, !0, {
        success: function (da, U) { result = U; },
        error: function (da, U) { console.error("[GTN] fetchTempleCommands error", da, U); },
    });

    return result.backbone.collections
        .find((item) => item.class_name === "TempleCommands")
        .data.map((item) => item.d);
}

async function createTempleMovement(movementId, templeId, user, town, type, startedAt, arrivalAt) {
    const url = `${BASE_URL}/api/temple/movement/add`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movementId, templeId, user, town, type, startedAt, arrivalAt }),
    });

    if (!response.ok) {
        throw new Error(`Vercel error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

async function sendToDiscord(webhookUrl, embed, ping = null) {
    const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "Grepolis Temple Notifier",
            content: ping || "",
            embeds: [embed],
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Discord error: ${response.status} ${response.statusText} — ${text}`);
    }

    return true;
}

function createSettingsWindow() {
    var wnd = null;
    for (let item of document.getElementsByClassName("ui-dialog-title")) {
        if (item.innerHTML === language.settings.title) {
            wnd = item.parentElement?.parentElement;
            break;
        }
    }

    if (!wnd) {
        wnd = Layout.wnd.Create(Layout.wnd.TYPE_DIALOG, language.settings.title);
    }

    wnd.setContent("");

    var windowItem = null;
    for (let item of document.getElementsByClassName("ui-dialog-title")) {
        if (item.innerHTML === language.settings.title) {
            windowItem = item;
            break;
        }
    }

    wnd.setHeight(document.body.scrollHeight / 2 + 100);
    wnd.setWidth("800");
    wnd.setTitle(language.settings.title);

    var frame = windowItem.parentElement.parentElement.children[1].children[4];
    frame.innerHTML = "";

    var html = document.createElement("html");
    var body = document.createElement("div");
    var head = document.createElement("head");

    var element = document.createElement("h3");
    element.innerHTML = language.settings.settings;
    body.appendChild(element);

    var list = document.createElement("ul");
    list.style = "overflow-y: scroll;overflow-x: hidden;";
    list.style.height = document.body.scrollHeight / 2 - 100 + "px";
    list.style.paddingBottom = "5px";

    createSettingsCheckbox(list, settings.send_support_message, "setting_send_support_message", language.settings.send_support_message);
    createSettingsCheckbox(list, settings.send_attack_message, "setting_send_attack_message", language.settings.send_attack_message);
    list.appendChild(document.createElement("hr"));

    createSettingsTextblock(list, language.settings.discord_support_hook);
    createSettingsTextbox(list, settings.discord_support_hook, "setting_discord_support_hook", 400);
    createSettingsTextblock(list, language.settings.discord_attack_hook);
    createSettingsTextbox(list, settings.discord_attack_hook, "setting_discord_attack_hook", 400);
    list.appendChild(document.createElement("hr"));

    createSettingsTextblock(list, language.settings.monitor_timeout);
    createSettingsTextbox(list, settings.monitor_timeout, "setting_monitor_timeout", 400, "number");
    list.appendChild(document.createElement("hr"));

    var element = document.createElement("p");
    element.innerHTML = "Grepolis Temple Notifier v." + GM_info.script.version;
    element.innerHTML += "<br>" + language.settings.credits;
    element.innerHTML += '<br><p style="font-size: xx-small">contact: <a href="mailto:contact@joswigchert.nl">contact@joswigchert.nl</a></p>';
    element.style.position = "absolute";
    element.style.bottom = "0";
    element.style.left = "0";
    element.style.marginBottom = "0";
    element.style.lineHeight = "1";
    list.appendChild(element);

    var savebutton = createSettingsButton("settings_reload", language.settings.save_reload);
    savebutton.style.position = "absolute";
    savebutton.style.bottom = "0";
    savebutton.style.right = "0";
    body.appendChild(savebutton);
    body.appendChild(list);

    html.appendChild(head);
    html.appendChild(body);
    frame.appendChild(html);

    $(".gtncheckbox").on("click", function () { swapCheckboxValue(this); });
    $(".gtntextbox").on("change", function () { setTextboxValue(this); });
    $("#settings_reload").on("click", function () { window.location.reload(); });

    addMeta("GTNSettings", "ready", "true");
}

function addMeta(metaName, attributeName, value) {
    var metaTag = document.createElement("meta");
    metaTag.name = metaName;
    var metaValue = document.createAttribute(attributeName);
    metaValue.value = value;
    metaTag.attributes.setNamedItem(metaValue);
    $("head").prepend(metaTag);
}

function swapCheckboxValue(element) {
    $("#" + element.id).toggleClass("checked");
    const checked = $(element).hasClass("checked");
    const key = element.id.replace(/^setting_/, "");
    settings[key] = checked;
    GM_setValue(element.id, checked);
}

function setTextboxValue(element) {
    let val = $(element).val();
    const key = element.id.replace(/^setting_/, "");
    if (key === "monitor_timeout") {
        val = Math.max(30000, Number(val) || 600000);
        $(element).val(val);
    }
    settings[key] = val;
    GM_setValue(element.id, val);
}

function createSettingsButton(id, text) {
    var element = document.createElement("div");
    element.className = "button_new";
    element.id = id;
    element.style.margin = "2px";
    var childElement = document.createElement("div");
    childElement.className = "left";
    element.appendChild(childElement);
    childElement = document.createElement("div");
    childElement.className = "right";
    element.appendChild(childElement);
    childElement = document.createElement("div");
    childElement.className = "caption js-caption";
    childElement.innerHTML = text + '<div class="effect js-effect"></div>';
    element.style.float = "left";
    element.appendChild(childElement);
    return element;
}

function createSettingsCheckbox(list, value, id, description) {
    var checkbox = document.createElement("div");
    checkbox.className = "cbx_icon";
    var caption = document.createElement("div");
    caption.className = "cbx_caption";
    var listItem = document.createElement("li").appendChild(document.createElement("div"));
    var state = value ? "checked" : "unchecked";
    listItem.id = id;
    listItem.className = "gtncheckbox checkbox_new " + state;
    caption.innerHTML = description;
    listItem.appendChild(checkbox);
    listItem.appendChild(caption);
    list.appendChild(listItem.parentElement);
}

function createSettingsTextbox(list, setting, id, width, type) {
    var listItem = document.createElement("div");
    listItem.className = "textbox";
    listItem.style.width = width + "px";
    if (setting == null) setting = "";
    listItem.innerHTML =
        '<div class="left"></div><div class="right"></div><div class="middle"><div class="ie7fix"><input tabindex="1" id="' +
        id + '" class="gtntextbox" value="' + setting + '" ' +
        (type ? 'type="' + type + '"' : '') +
        ' size="10" type="text"></div></div>';
    list.appendChild(listItem);
}

function createSettingsTextblock(list, description) {
    var p = document.createElement("p");
    p.innerHTML = description;
    list.appendChild(p);
}
