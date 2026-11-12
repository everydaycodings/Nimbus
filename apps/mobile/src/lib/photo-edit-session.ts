// Edit-before-upload: a screen that wants a picture edited asks here and waits. The editor takes the request when it opens
// and answers with the edited file, or null when the person leaves it as it was.
import { router } from "expo-router"

export type Shot = { uri: string; name: string; mime: string }
export type Edited = { uri: string; size: number; mime: string }
type Request = { shot: Shot; done: (r: Edited | null) => void }

let waiting: Request | null = null

export function editShot(shot: Shot) {
  return new Promise<Edited | null>((done) => {
    waiting = { shot, done }
    router.push("/photo-edit")
  })
}
export const peekRequest = () => (waiting && { shot: waiting.shot, done: answer })
function answer(r: Edited | null) {
  const w = waiting
  waiting = null
  w?.done(r)
}
