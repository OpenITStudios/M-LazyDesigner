// View-only color state: Rust's Cube and texture data are never changed by selection.
export function cubeSelectionColors(cubeUuid: string, selectedId: string | null, fallbackColor: number):
  { untextured: number; outline: number } {
  return selectedId === cubeUuid
    ? { untextured: 0x80b8ef, outline: 0xf8fafc }
    : { untextured: fallbackColor, outline: 0x46535f };
}
