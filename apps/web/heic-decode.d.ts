declare module "heic-decode" {
  export default function decode(o: { buffer: ArrayBufferLike }): Promise<{
    width: number
    height: number
    data: Uint8ClampedArray
  }>
}
