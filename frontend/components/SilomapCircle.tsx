import React, { useMemo, useRef } from 'react';
import { View, StyleSheet, useWindowDimensions, Text } from 'react-native';
import { Canvas, useThree, useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';

// Suppress THREE.Clock deprecation: patch before r3f uses it
if (typeof (THREE as any).Clock !== 'undefined') {
  const _Clock = (THREE as any).Clock;
  // Only patch if THREE.Timer exists (THREE >= 0.165)
  if (typeof (THREE as any).Timer !== 'undefined' && !(_Clock as any).__patched) {
    const _origWarn = console.warn;
    console.warn = (...args: any[]) => {
      if (typeof args[0] === 'string' && args[0].includes('THREE.Clock')) return;
      _origWarn(...args);
    };
    (_Clock as any).__patched = true;
  }
}

type HeatPoint = { x: number; y: number; z: number; temp: number };
type Cell = { id: string; index_x: number; index_y: number; status: string };

const SCALE = 2;
const CELL_M = 0.2;
const CELL_W = CELL_M * SCALE; // 0.4 world units per cell
const GAP = 0.035;

// ── Helpers ─────────────────────────────────────────────────

function cellColor(status: string, isStart: boolean) {
  if (isStart) return '#EA575F';
  switch (status) {
    case 'completed': return '#EA575F';
    case 'active':    return '#00D5FF';
    default:          return '#1A0A0B';
  }
}

function cellEmissive(status: string, isStart: boolean) {
  if (isStart) return '#EA575F';
  switch (status) {
    case 'completed': return '#7a1a20';
    case 'active':    return '#006688';
    default:          return '#000000';
  }
}

// ── Single cell tile — only rendered if centre is inside the circle ──

function CellTile({ cell, radius, isStart }: { cell: Cell; radius: number; isStart: boolean }) {
  const cx = (cell.index_x + 0.5) * CELL_W - radius;
  const cz = (cell.index_y + 0.5) * CELL_W - radius;

  if (Math.sqrt(cx * cx + cz * cz) > radius) return null;

  return (
    <mesh
      position={[cx, isStart ? 0.012 : 0.006, cz]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[CELL_W - GAP, CELL_W - GAP]} />
      <meshStandardMaterial
        color={cellColor(cell.status, isStart)}
        emissive={cellEmissive(cell.status, isStart)}
        emissiveIntensity={isStart ? 1.2 : 0.6}
      />
    </mesh>
  );
}

// ── Main 3-D scene ───────────────────────────────────────────

function SiloScene({
  data, cells, radius, cylH, startingCellId,
}: {
  data: HeatPoint[];
  cells: Cell[];
  radius: number;
  cylH: number;
  startingCellId?: string | null;
}) {
  const latest = data[data.length - 1];

  // Circular outlines: top rim (bright), bottom rim + 8 struts (dim)
  const outlines = useMemo(() => {
    const brightMat = new THREE.LineBasicMaterial({ color: '#EA575F', transparent: true, opacity: 0.75 });
    const dimMat    = new THREE.LineBasicMaterial({ color: '#EA575F', transparent: true, opacity: 0.30 });

    const makeRing = (y: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
      }
      return new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        y === cylH ? brightMat : dimMat,
      );
    };

    const makeStrut = (idx: number) => {
      const a = (idx / 8) * Math.PI * 2;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      return new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x, 0, z),
          new THREE.Vector3(x, cylH, z),
        ]),
        dimMat,
      );
    };

    return [
      makeRing(cylH),
      makeRing(0),
      ...Array.from({ length: 8 }, (_, i) => makeStrut(i)),
    ];
  }, [radius, cylH]);

  return (
    <group position={[0, -cylH, 0]}>
      {/* Solid silo body */}
      <mesh position={[0, cylH / 2, 0]}>
        <cylinderGeometry args={[radius, radius, cylH, 64]} />
        <meshStandardMaterial color="#1F0A0C" />
      </mesh>

      {/* Outline wires */}
      {outlines.map((obj, i) => (
        <primitive key={i} object={obj} />
      ))}

      {/* Top face */}
      <group position={[0, cylH, 0]}>
        {/* Grout disc — red bleeds through cell gaps to form the grid lines */}
        <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[radius, 64]} />
          <meshBasicMaterial color="#EA575F" transparent opacity={0.35} />
        </mesh>

        {/* Cell tiles */}
        {cells.map((cell) => (
          <CellTile
            key={cell.id}
            cell={cell}
            radius={radius}
            isStart={cell.id === startingCellId}
          />
        ))}

        {/* Robot cursor */}
        {latest && (
          <mesh position={[latest.x, 0.25, latest.z]}>
            <sphereGeometry args={[0.22, 16, 16]} />
            <meshStandardMaterial
              color="#00D5FF"
              emissive="#00D5FF"
              emissiveIntensity={1.8}
            />
          </mesh>
        )}
      </group>
    </group>
  );
}

// ── Camera controller ──

function CameraController({
  baseCamY, baseCamZ, zoomRef, targetRef,
}: {
  baseCamY: number;
  baseCamZ: number;
  zoomRef: React.MutableRefObject<number>;
  targetRef: React.MutableRefObject<{ x: number; z: number }>;
}) {
  const { camera } = useThree();

  useFrame(() => {
    const zoom = zoomRef.current;
    const { x: panX, z: panZ } = targetRef.current;
    camera.position.set(panX, baseCamY / zoom, panZ + baseCamZ / zoom);
    camera.lookAt(panX, 0, panZ);
  });

  return null;
}

// ── Legend row ───────────────────────────────────────────────

function Legend() {
  const items = [
    { color: '#EA575F', label: 'Visited' },
    { color: '#00D5FF', label: 'Active'  },
    { color: '#2A1215', label: 'Pending' },
  ];
  return (
    <View style={styles.legend}>
      {items.map(({ color, label }) => (
        <View key={label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: color }]} />
          <Text style={styles.legendLabel}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Public component ─────────────────────────────────────────

const SiloMapCircle = ({
  points = [],
  cells = [],
  hangar = null,
  startingCellId = null,
}: {
  points: HeatPoint[];
  cells?: Cell[];
  hangar?: any;
  startingCellId?: string | null;
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const canvasWidth  = screenWidth - 32 - 36;
  const canvasHeight = Math.round(canvasWidth * 0.75); // match rectangle aspect ratio

  const diameterM = hangar?.diameter ?? 5;
  const radius    = (diameterM * SCALE) / 2;
  const cylH      = 1.4;

  // Camera: fit circle into the canvas at a fixed elevation angle
  const aspectRatio    = canvasWidth / canvasHeight;
  const fov            = 50;
  const halfFovV       = (fov / 2) * (Math.PI / 180);
  const halfFovH       = Math.atan(Math.tan(halfFovV) * aspectRatio);
  const elevationAngle = 38 * (Math.PI / 180);
  const MARGIN         = 1.15;

  const dist = Math.max(
    (radius * MARGIN) / Math.tan(halfFovH),
    ((radius + cylH) * MARGIN) / Math.tan(halfFovV),
  );
  const camY     = dist * Math.sin(elevationAngle);
  const camZ     = dist * Math.cos(elevationAngle);
  const baseDist = dist;

  // Gesture refs
  const zoomRef      = useRef(1);
  const lastZoomRef  = useRef(1);
  const targetRef    = useRef({ x: 0, z: 0 });
  const prevScaleRef = useRef(1);
  const focalNDCRef  = useRef({ x: 0, y: 0 });
  const camParamsRef = useRef({ halfFovH, halfFovV, baseDist, elevationAngle, canvasWidth, canvasHeight });
  camParamsRef.current = { halfFovH, halfFovV, baseDist, elevationAngle, canvasWidth, canvasHeight };

  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .onStart((event) => {
      prevScaleRef.current = 1;
      const p = camParamsRef.current;
      focalNDCRef.current = {
        x:  (event.focalX / p.canvasWidth)  * 2 - 1,
        y: -((event.focalY / p.canvasHeight) * 2 - 1),
      };
    })
    .onUpdate((event) => {
      const deltaScale = event.scale / prevScaleRef.current;
      prevScaleRef.current = event.scale;

      const oldZoom = zoomRef.current;
      const newZoom = Math.max(0.4, Math.min(5, oldZoom * deltaScale));

      const { halfFovH: hFovH, halfFovV: hFovV, baseDist: bDist, elevationAngle: elev } = camParamsRef.current;
      const oldHalfW = (bDist / oldZoom) * Math.tan(hFovH);
      const newHalfW = (bDist / newZoom) * Math.tan(hFovH);
      const oldHalfD = (bDist / oldZoom) * Math.tan(hFovV) / Math.sin(elev);
      const newHalfD = (bDist / newZoom) * Math.tan(hFovV) / Math.sin(elev);

      const { x: fx, y: fy } = focalNDCRef.current;
      targetRef.current = {
        x: targetRef.current.x + fx * (oldHalfW - newHalfW),
        z: targetRef.current.z - fy * (oldHalfD - newHalfD),
      };
      zoomRef.current = newZoom;
    })
    .onEnd(() => { lastZoomRef.current = zoomRef.current; });

  const lastPanRef = useRef({ x: 0, y: 0 });

  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .minPointers(1)
    .maxPointers(1)
    .onStart((event) => { lastPanRef.current = { x: event.x, y: event.y }; })
    .onUpdate((event) => {
      const dx = event.x - lastPanRef.current.x;
      const dy = event.y - lastPanRef.current.y;
      lastPanRef.current = { x: event.x, y: event.y };

      const { halfFovH: hFovH, halfFovV: hFovV, baseDist: bDist, elevationAngle: elev } = camParamsRef.current;
      const zoom = zoomRef.current;
      const worldPerPxX = (2 * (bDist / zoom) * Math.tan(hFovH)) / camParamsRef.current.canvasWidth;
      const worldPerPxZ = (2 * (bDist / zoom) * Math.tan(hFovV)) / (Math.sin(elev) * camParamsRef.current.canvasHeight);

      targetRef.current = {
        x: targetRef.current.x - dx * worldPerPxX,
        z: targetRef.current.z - dy * worldPerPxZ,
      };
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  return (
    <View style={[styles.wrapper, { width: canvasWidth }]}>
      <View style={[styles.container, { width: canvasWidth, height: canvasHeight }]}>
        <Canvas
          camera={{ position: [0, camY, camZ], fov, near: 0.1, far: 300 }}
          gl={{ antialias: false, powerPreference: 'high-performance' }}
        >
          <color attach="background" args={['#0D0305']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[4, 10, 6]}  intensity={2.0} />
          <directionalLight position={[-3, 5, -4]} intensity={0.5} />
          <CameraController
            baseCamY={camY}
            baseCamZ={camZ}
            zoomRef={zoomRef}
            targetRef={targetRef}
          />
          <SiloScene
            data={points}
            cells={cells}
            radius={radius}
            cylH={cylH}
            startingCellId={startingCellId}
          />
        </Canvas>
        {/* Touch overlay — sibling after Canvas so it captures touches first */}
        <GestureDetector gesture={composedGesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false} />
        </GestureDetector>
      </View>
      <Legend />
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'center',
  },
  container: {
    backgroundColor: '#0D0305',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#3A1015',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    paddingTop: 10,
    paddingBottom: 2,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    color: '#9A7070',
    fontSize: 12,
    fontWeight: '500',
  },
});

export default SiloMapCircle;
