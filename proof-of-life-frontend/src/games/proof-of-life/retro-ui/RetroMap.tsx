import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { getCellPlan, isBlockedTile, isHideTile, listDoorMarkers, MAP_LABELS, ROOM_LEGEND } from '../world/floorplan';
import { encryption, type EncryptedSecret } from '../utils/encryption';
import type { SessionState, TowerId } from '../model';

export function RetroMap(props: {
  session: SessionState;
  secret: EncryptedSecret | null;
  towers: { id: TowerId; label: string; x: number; y: number }[];
  showChadMarker?: boolean;
  showAssassinMarker?: boolean;
  assassinPath?: readonly { x: number; y: number }[];
  assassinPathStart?: { x: number; y: number } | null;
  onTileClick?: (coord: { x: number; y: number }) => void;
}) {
  const { session, secret } = props;
  const showChadMarker = props.showChadMarker ?? true;
  const showAssassinMarker = props.showAssassinMarker ?? true;
  const decryptedSecret = useMemo(() => (secret ? encryption.decrypt(secret) : null), [secret]);
  const pathIndexByCoord = useMemo(() => {
    const m = new Map<string, number>();
    (props.assassinPath ?? []).forEach((p, idx) => m.set(`${p.x},${p.y}`, idx));
    return m;
  }, [props.assassinPath]);
  const lastPath = props.assassinPath && props.assassinPath.length ? props.assassinPath[props.assassinPath.length - 1] : null;
  
  return (
    <div className="w-full h-full flex items-center justify-center p-2 relative">
      
      {/* Tactical Border / Rulers Container */}
      <div className="relative aspect-square h-full max-h-full max-w-full p-6 sm:p-8">
        
        {/* Corner Markers */}
        <div className="absolute top-0 left-0 w-4 h-4 border-l-2 border-t-2 border-emerald-500/50" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r-2 border-t-2 border-emerald-500/50" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l-2 border-b-2 border-emerald-500/50" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r-2 border-b-2 border-emerald-500/50" />

        {/* X-Axis Ruler (Top) */}
        <div className="absolute top-1 left-8 right-8 h-4 flex justify-between text-[8px] font-mono text-emerald-500/50 select-none">
           {Array.from({length: 10}).map((_, i) => (
             <span key={i} className="flex-1 text-center">{i}</span>
           ))}
        </div>
        
        {/* Y-Axis Ruler (Left) */}
        <div className="absolute left-1 top-8 bottom-8 w-4 flex flex-col justify-between text-[8px] font-mono text-emerald-500/50 select-none">
           {Array.from({length: 10}).map((_, i) => (
             <span key={i} className="flex-1 flex items-center justify-center">{i}</span>
           ))}
        </div>

        {/* The Grid Layer */}
        <div 
          className="w-full h-full relative"
          style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(10, 1fr)', 
              gridTemplateRows: 'repeat(10, 1fr)',
              gap: '2px' 
          }}
        >
          {Array.from({ length: 100 }).map((_, idx) => {
              const x = idx % 10;
              const y = Math.floor(idx / 10);
              const isChad = showChadMarker && x === (session.chad_x ?? 5) && y === (session.chad_y ?? 5);
              const isAssassin = !!decryptedSecret && showAssassinMarker && x === decryptedSecret.assassin.x && y === decryptedSecret.assassin.y;
              const isVisibleAssassinMarker = isAssassin && session.mode === 'two-player';
              const pathIdx = pathIndexByCoord.get(`${x},${y}`);
              const isPath = typeof pathIdx === 'number';
              const isPathStart = !!props.assassinPathStart && x === props.assassinPathStart.x && y === props.assassinPathStart.y;
              const isPathEnd = !!lastPath && x === lastPath.x && y === lastPath.y;
              const plan = getCellPlan(x, y);
              const meta = ROOM_LEGEND[plan.room];
              
              const style = {
                ['--cellFill' as any]: meta.fill,
                ['--wallN' as any]: plan.walls.N ? '2px' : '0px',
                ['--wallE' as any]: plan.walls.E ? '2px' : '0px',
                ['--wallS' as any]: plan.walls.S ? '2px' : '0px',
                ['--wallW' as any]: plan.walls.W ? '2px' : '0px',
              } as CSSProperties;

              return (
              <div
                  key={idx}
                  className={`pol-cell ${isChad ? 'pol-cell--chad' : ''} ${isHideTile(x, y) ? 'pol-cell--hide' : ''} ${
                  isBlockedTile(x, y) ? 'pol-cell--blocked' : ''
                  } ${isAssassin ? 'pol-cell--assassin' : ''} ${isVisibleAssassinMarker ? 'pol-cell--assassinVisible' : ''} ${
                    isPath ? 'pol-cell--path' : ''
                  } ${isPathStart ? 'pol-cell--pathStart' : ''} ${isPathEnd ? 'pol-cell--pathEnd' : ''} ${
                    props.onTileClick ? 'cursor-pointer' : ''
                  }`}
                  style={style}
                  title={`${x},${y} ${meta.label}${isChad ? ' (CHAD)' : ''}${isPath ? ` [PATH ${Number(pathIdx) + 1}]` : ''}`}
                  onClick={props.onTileClick ? () => props.onTileClick?.({ x, y }) : undefined}
              >
                {isPath ? (
                  <span className="pol-cellPathStep" aria-hidden="true">
                    {Number(pathIdx) + 1}
                  </span>
                ) : null}
              </div>
              );
          })}

          {/* Overlays (Door, Tower, Labels) */}
          <div className="absolute inset-0 pointer-events-none grid grid-cols-10 grid-rows-10 gap-[2px]">
              {/* Doors */}
              {listDoorMarkers().map((d, i) => (
              <div
                  key={`door-${i}`}
                  className={`pol-door pol-door--${d.dir} pol-door--${d.state}`}
                  style={{
                    gridColumn: `${d.x + 1} / span 1`,
                    gridRow: `${d.y + 1} / span 1`,
                  }}
              />
              ))}
              
              {/* Towers */}
              {props.towers.map((t) => (
              <div
                  key={`tower-${t.id}`}
                  className="pol-towerMarker relative flex items-center justify-center z-10"
                  style={{
                    gridColumn: `${t.x + 1} / span 1`,
                    gridRow: `${t.y + 1} / span 1`,
                  }}
              >
                  <div className="absolute inset-0 border border-cyan-400/50 rounded-full animate-ping opacity-20" />
                  <div className="w-[80%] h-[80%] border border-cyan-400 bg-cyan-950/80 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(34,211,238,0.3)] backdrop-blur-sm">
                    <span className="text-[8px] sm:text-[10px] font-bold text-cyan-100">{t.id}</span>
                  </div>
              </div>
              ))}

              {/* Labels */}
              {MAP_LABELS.map((l) => (
              <div
                  key={`label-${l.label}`}
                  className="pol-mapLabel flex items-center justify-center text-center z-0 pointer-events-none"
                  style={{
                    gridColumn: `${l.x + 1} / span ${l.w}`,
                    gridRow: `${l.y + 1} / span ${l.h}`,
                    fontSize: 'clamp(8px, 1.5cqw, 12px)',
                  }}
              >
                  <span className="bg-black/40 px-1 rounded backdrop-blur-[1px]">{l.label}</span>
              </div>
              ))}
          </div>
        </div>

        {/* Scanline Overlay for Map only */}
        <div className="absolute inset-6 pointer-events-none overflow-hidden rounded-lg">
           <div className="absolute top-0 left-0 right-0 h-[2px] bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.4)] animate-[scan_4s_linear_infinite]" />
        </div>
      </div>
    </div>
  );
}
