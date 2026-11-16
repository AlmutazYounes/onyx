export function getUserName(user) {
  return `${user.first} ${user.last}`;
}

export function sortUsers(users) {
  return [...users].sort((a, b) => getUserName(a).localeCompare(getUserName(b)));
}
