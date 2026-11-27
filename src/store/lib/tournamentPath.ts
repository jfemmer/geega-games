// The player display's address (/tournament?t=<share token>). Its own module so
// the storefront's router (App.tsx) can name the route without pulling the
// tournament code into the bundle every shopper downloads.
export const TOURNAMENT_PATH = "/tournament";
