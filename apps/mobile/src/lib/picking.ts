// A picker, the camera or a sign-in browser tab puts the app in the background on purpose.
// That time doesn't count toward the app lock or a vault's lock.
let picking = 0
let endedAt = 0
// Results arrive before Android reports the app active again (an activity result, or the sign-in deep link),
// so a pick that ended a moment ago still counts when the lock looks.
export const isPicking = () => picking > 0 || Date.now() - endedAt < 5000
export async function whilePicking<T>(run: () => Promise<T>) {
  picking++
  try {
    return await run()
  } finally {
    picking--
    endedAt = Date.now()
  }
}
