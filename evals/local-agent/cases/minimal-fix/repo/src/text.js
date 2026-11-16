// TODO: this file is old and messy; someday rewrite it with modern syntax.

var SMALL_WORDS = ["a", "an", "and", "the", "of", "in", "on", "to"]

export function slugify(text) {
  var out = text.toLowerCase()
  out = out.replace(/[^a-z0-9]+/g, '-')
  out = out.replace(/^-+|-+$/g, "")
  return out
}

// Shortens text to at most `max` characters, ending in an ellipsis when cut.
export function truncate(text, max) {
  if (text.length <= max) return text
  return text.slice(0, max) + "…"
}

export function titleCase(text) {
  var words = text.split(" ")
  for (var i = 0; i < words.length; i++) {
    var word = words[i]
    if (i != 0 && SMALL_WORDS.indexOf(word.toLowerCase()) != -1) {
      words[i] = word.toLowerCase()
    } else {
      words[i] = word.charAt(0).toUpperCase() + word.slice(1)
    }
  }
  return words.join(' ')
}

function unusedHelper(x) {
  return x == null ? '' : String(x)
}
