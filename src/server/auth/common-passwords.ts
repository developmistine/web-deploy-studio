/**
 * Local blocklist of very common passwords / base words and context-specific terms (lower-case, separators removed).
 * Matching is done on the whole password and on its "base" with leading/trailing digits and symbols stripped,
 * so "Password2026!!!!!" is caught via "password".
 *
 * This is NOT a full breached-password corpus check (Planned — see docs/security/password-security.md); it blocks
 * the most predictable choices without sending anything to an external service.
 */
const WORDS = `
password passw0rd passwort motdepasse contrasena senha parola wachtwoord haslo salasana jelszo heslo
qwerty qwertyuiop qwertz azerty asdfgh asdfghjkl zxcvbn zxcvbnm qazwsx qweasd qweasdzxc 1q2w3e4r 1q2w3e4r5t
letmein welcome welcomeback welcome1 changeme changeit default secret secrets private passphrase mypassword
iloveyou iloveu loveyou lovely love sunshine princess dragon monkey master shadow superman batman football
baseball soccer basketball hockey michael jennifer jordan hunter killer trustno1 whatever freedom flower
starwars pokemon minecraft fortnite computer internet google facebook microsoft windows apple samsung
admin administrator root toor guest user test tester testing demo sample example login logon signin access
system server database backup deploy deployment deploystudio deploystudios studio website webmaster
company corporate office business manager staff employee intranet portal secure security service support
summer winter spring autumn monday friday january december thailand bangkok bwdeploy
abc abcd abcde abcdef abc123 abcd1234 aaaaaa zzzzzz qqqqqq
`

export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(WORDS.split(/\s+/).filter(Boolean))
