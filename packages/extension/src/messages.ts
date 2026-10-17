/** Messages the popup sends to the service worker. */
export type Message = { type: "login" } | { type: "cancel-login" };
