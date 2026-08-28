import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: '2024-04-03',
  devtools: { enabled: true },
  vite: {
    plugins: [
      tailwindcss(),
    ],
  },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    webhookOlympus: '',
    webhookAttackReprod: '',
    webhookAttackOffTer: '',
    webhookAttackOffNav: '',
    webhookAttackDef: '',
    webhookAttackPortail1: '',
    webhookAttackPortail2: '',
    whitelistedPlayers: '',
  },
})