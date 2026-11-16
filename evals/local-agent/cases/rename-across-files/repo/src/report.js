import { getUserName, sortUsers } from "./users.js";

export function report(users) {
  return sortUsers(users)
    .map((user, index) => `${index + 1}. ${getUserName(user)}`)
    .join("\n");
}
