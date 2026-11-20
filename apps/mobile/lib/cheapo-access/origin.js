// @ts-check

/** @param {unknown} value @returns {string | null} */
function parseCheapoApiOrigin(value) {
  if (typeof value !== "string" || !/^https:\/\/[^/?#\\\s]+\/?$/i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url.origin;
  } catch {
    return null;
  }
}

module.exports = { parseCheapoApiOrigin };
