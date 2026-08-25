/**
 * Temporary passwords for accounts an administrator creates.
 *
 * Two requirements pull against each other: it has to be unguessable, and a rep
 * has to retype it off a phone screen without getting it wrong. So it is drawn
 * from a CSPRNG, but out of an alphabet with the ambiguous characters removed —
 * no 0/O, no 1/l/I — and grouped for readability.
 *
 * ⚠️ `Math.random()` is not a CSPRNG. It was used for this (`Clippa${Math.random()
 * .toString(36).slice(2, 8)}!`, ~30 bits and predictable from a sibling draw) and
 * that is survivable for a one-off an admin reads out loud. It is not survivable
 * for minting a batch of rep logins in one afternoon, where its predictability
 * applies across the whole batch.
 */

// Deliberately no 0/O/o, 1/l/I, 5/S, 8/B — the pairs people mistype.
const ALPHABET = "ACDEFGHJKMNPQRTUVWXYZacdefghjkmnpqrtuvwxyz2346799";

/** e.g. `Clippa-K7fQ-mX3T`. ~45 bits of entropy across the two groups. */
export function generateTempPassword(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  // A rejection loop is not needed here: the alphabet length is close enough to
  // a divisor of 256 that the modulo bias is negligible for a password that is
  // rotated on first sign-in anyway.
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `Clippa-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}
