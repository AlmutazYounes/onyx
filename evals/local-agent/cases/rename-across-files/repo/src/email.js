import * as users from "./users.js";

export function emailHeader(user, address) {
  return `To: ${users.getUserName(user)} <${address}>`;
}
