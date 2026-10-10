/*
 * Deploy-time configuration for the static status page.
 *
 * Set this to the base URL of your Stelena deployment (the same host the bot
 * serves GET /status on). It is public information, so it is fine to commit.
 *
 *   window.STELENA_API = "https://stelena.example.com";
 *
 * Leave it empty to use the built-in default. Visitors can also override it at
 * runtime with ?api=https://host (saved to localStorage) or the in-page
 * settings box, which is handy when you host the page somewhere else.
 */
window.STELENA_API = "";
