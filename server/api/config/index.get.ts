export default defineEventHandler(() => {
    const config = useRuntimeConfig();

    return {
        olympusHook: config.webhookOlympus || null,
        hooksByAlliance: {
            420: { support: null, attack: config.webhookAttackReprod || null },
            121: { support: null, attack: config.webhookAttackOffTer || null },
            856: { support: null, attack: config.webhookAttackOffNav || null },
            833: { support: null, attack: config.webhookAttackDef || null },
            209: { support: null, attack: config.webhookAttackPortail1 || null },
            118: { support: null, attack: config.webhookAttackPortail2 || null },
        },
        whitelistedPlayers: config.whitelistedPlayers
            ? config.whitelistedPlayers.split(',').map((p: string) => p.trim())
            : [],
    };
});
