export interface User {
  id: number
  name: string
  role: string
  city: string
  commits: number[]
}

export const users: User[] = [
  { id: 1, name: 'Ada Lovelace', role: 'Analyst', city: 'London', commits: [3, 5, 2, 8, 6, 9, 4, 7, 10, 6] },
  { id: 2, name: 'Grace Hopper', role: 'Admiral', city: 'Arlington', commits: [7, 8, 6, 9, 12, 10, 11, 9, 13, 12] },
  { id: 3, name: 'Linus Torvalds', role: 'Maintainer', city: 'Portland', commits: [20, 18, 25, 22, 30, 28, 26, 31, 29, 35] },
  { id: 4, name: 'Evan You', role: 'Author', city: 'Singapore', commits: [9, 14, 11, 16, 12, 18, 15, 17, 21, 19] },
]

/** Simulated network request. */
export async function fetchUser(id: number, delay = 700): Promise<User | undefined> {
  await new Promise((r) => setTimeout(r, delay))
  return users.find((u) => u.id === id)
}
