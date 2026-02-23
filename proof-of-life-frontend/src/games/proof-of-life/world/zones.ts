import { getRoomCodeAt, ROOM_LEGEND } from './floorplan';

export function getRoomDescription(x: number, y: number): { label: string; flavor: string; key: string } {
  const code = getRoomCodeAt(x, y);
  const meta = ROOM_LEGEND[code];
  return { label: meta.label, flavor: meta.flavor, key: code };
}
