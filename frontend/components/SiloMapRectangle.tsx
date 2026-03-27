import React, { useMemo, useRef } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Canvas, useThree, useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';

type HeatPoint = { x: number; y: number; z: number; temp: number };
type Cell = { id: string; hangar_id: string; index_x: number; index_y: number; status: string; last_visited_at: string | null };
type Hangar = { id: string; width: number; height: number };

const SCALE = 2;
const CELL_M = 0.2;
const CELL_W = CELL_M * SCALE;

/**
 * A single coloured tile on the top face.
 * `swapped` = true when we've rotated so index_y → X (long side), index_x → Z (short side).
 */
function CellTile({
  cell, longSide, shortSide, swapped, isStart,
}: {
  cell: Cell; longSide: number; shortSide: number; swapped: boolean; isStart: boolean;
}) {
  const color = isStart
    ? '#EA575F'
    : cell.status === 'completed' ? '#EA575F'
    : cell.status === 'active'    ? '#00D5FF' : '#1A0A0B';

  const emissive = isStart
    ? '#EA575F'
    : cell.status === 'completed' ? '#7a1a20'
    : cell.status === 'active'    ? '#006688' : '#000000';

  const emissiveIntensity = isStart ? 1.2 : 0.6;

  // X axis = longSide (left-right), Z axis = shortSide (toward camera)
  const cx = swapped
    ? (cell.index_y + 0.5) * CELL_W - longSide / 2
    : (cell.index_x + 0.5) * CELL_W - longSide / 2;
  const cz = swapped
    ? (cell.index_x + 0.5) * CELL_W - shortSide / 2
    : (cell.index_y + 0.5) * CELL_W - shortSide / 2;

  // Make gap big enough to show crisp grid lines
  const GAP = 0.035;

  return (
    <mesh position={[cx, isStart ? 0.012 : 0.006, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[CELL_W - GAP, CELL_W - GAP]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
    </mesh>
  );
}

function BarnScene({
  data, cells, longSide, shortSide, boxH, swapped, startingCellId,
}: {
  data: HeatPoint[];
  cells: Cell[];
  longSide: number;
  shortSide: number;
  boxH: number;
  swapped: boolean;
  startingCellId?: string | null;
}) {
  const latest = data[data.length - 1];

  // Creates just the border edges (no diagonal triangles)
  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(longSide, boxH, shortSide)),
    [longSide, shortSide, boxH]
  );

  // Shift group DOWN so the top face sits at y = 0
  return (
    <group position={[0, -boxH, 0]}>
      {/* Solid barn body */}
      <mesh position={[0, boxH / 2, 0]}>
        {/* X = long (left-right), Y = height, Z = short (towards camera) */}
        <boxGeometry args={[longSide, boxH, shortSide]} />
        <meshStandardMaterial color="#1F0A0C" />
      </mesh>

      {/* Crisp Outline along the 12 box edges */}
      <lineSegments geometry={edges} position={[0, boxH / 2, 0]}>
        <lineBasicMaterial color="#EA575F" linewidth={2} transparent opacity={0.6} />
      </lineSegments>



      {/* Cell grid on the top face */}
      <group position={[0, boxH, 0]}>
        
        {/* ── Grid Outline Layer (Grout) ── */}
        {/* Sits just beneath the cells. The gaps between cells reveal this colour, creating a sharp grid outline. */}
        <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[longSide, shortSide]} />
          <meshBasicMaterial color="#EA575F" transparent opacity={0.35} />
        </mesh>

        {cells.map(cell => (
          <CellTile
            key={cell.id}
            cell={cell}
            longSide={longSide}
            shortSide={shortSide}
            swapped={swapped}
            isStart={cell.id === startingCellId}
          />
        ))}

        {latest && (
          <mesh position={[
            swapped ? latest.z : latest.x,
            0.25,
            swapped ? latest.x : latest.z
          ]}>
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

/** Controls the camera zoom and pan via shared refs updated by pinch gesture */
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
    // Camera stays at same elevation angle; X and Z shift follows the pan target
    camera.position.set(panX, baseCamY / zoom, panZ + baseCamZ / zoom);
    camera.lookAt(panX, 0, panZ);
  });

  return null;
}

const SiloMapRectangle = ({
  points = [],
  cells  = [],
  hangar = null,
  startingCellId = null,
}: {
  points:  HeatPoint[];
  cells?:  Cell[];
  hangar?: Hangar | null;
  startingCellId?: string | null;
}) => {
  const { width: screenWidth } = useWindowDimensions();
  // 16px horizontal padding on each side inside the card (matches scroll paddingHorizontal + card padding)
  const canvasWidth = screenWidth - 32 - 36; // scroll padding + card padding
  const canvasHeight = Math.round(canvasWidth * 0.75);

  const dimX = (hangar?.width  ?? 2) * SCALE;
  const dimZ = (hangar?.height ?? 2) * SCALE;
  const boxH = 1.4;

  // Always put the LONG dimension left-right (X axis) to face the user
  const swapped   = dimZ > dimX;
  const longSide  = swapped ? dimZ : dimX;   // X axis (horizontal)
  const shortSide = swapped ? dimX : dimZ;   // Z axis (depth)

  // ── Camera: fit the long side of the hangar into the canvas width ──
  // Fixed elevation angle (35°) then back-calculate distance so longSide
  // exactly spans the horizontal FOV with a small margin.
  const aspectRatio = canvasWidth / canvasHeight;

  // Fixed FOV — we move the camera to fit, rather than adjusting FOV
  const fov = 50;
  const halfFovV = (fov / 2) * (Math.PI / 180);
  const halfFovH = Math.atan(Math.tan(halfFovV) * aspectRatio);

  // Elevation: camera looks down at ~38°
  const elevationAngle = 38 * (Math.PI / 180);

  // Required distance from scene centre so the full shape fits both axes
  // with a 15% margin on each side (1.15×)
  const MARGIN = 1.15;
  const distForWidth  = (longSide  / 2 * MARGIN) / Math.tan(halfFovH);
  const distForHeight = ((shortSide / 2 + boxH) * MARGIN) / Math.tan(halfFovV);
  const dist = Math.max(distForWidth, distForHeight);

  const camY = dist * Math.sin(elevationAngle);
  const camZ = dist * Math.cos(elevationAngle);
  const camX = 0;
  const baseDist = dist; // camera-to-target distance at zoom=1

  // ── Pinch-to-zoom toward focal point ──
  const zoomRef = useRef(1);
  const lastZoomRef = useRef(1);
  const targetRef = useRef({ x: 0, z: 0 });
  const prevScaleRef = useRef(1);
  const focalNDCRef = useRef({ x: 0, y: 0 });
  // Store current cam params in a ref so gesture handlers always read fresh values
  const camParamsRef = useRef({ halfFovH, halfFovV, baseDist, elevationAngle, canvasWidth, canvasHeight });
  camParamsRef.current = { halfFovH, halfFovV, baseDist, elevationAngle, canvasWidth, canvasHeight };

  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .onStart((event) => {
      prevScaleRef.current = 1;
      // Capture pinch focal point as NDC (-1 to 1) relative to canvas centre
      const p = camParamsRef.current;
      focalNDCRef.current = {
        x:  (event.focalX / p.canvasWidth)  * 2 - 1,
        y: -((event.focalY / p.canvasHeight) * 2 - 1), // flip Y: up = positive
      };
    })
    .onUpdate((event) => {
      const deltaScale = event.scale / prevScaleRef.current;
      prevScaleRef.current = event.scale;

      const oldZoom = zoomRef.current;
      const newZoom = Math.max(0.4, Math.min(5, oldZoom * deltaScale));

      const { halfFovH: hFovH, halfFovV: hFovV, baseDist: bDist, elevationAngle: elev } = camParamsRef.current;
      // World half-extents visible at each zoom level
      const oldHalfW = (bDist / oldZoom) * Math.tan(hFovH);
      const newHalfW = (bDist / newZoom) * Math.tan(hFovH);
      // Z extent accounts for the elevation angle projection
      const oldHalfD = (bDist / oldZoom) * Math.tan(hFovV) / Math.sin(elev);
      const newHalfD = (bDist / newZoom) * Math.tan(hFovV) / Math.sin(elev);

      const { x: fx, y: fy } = focalNDCRef.current;
      // Shift target so the world point under the pinch stays fixed on screen
      targetRef.current = {
        x: targetRef.current.x + fx * (oldHalfW - newHalfW),
        z: targetRef.current.z - fy * (oldHalfD - newHalfD),
      };
      zoomRef.current = newZoom;
    })
    .onEnd(() => {
      lastZoomRef.current = zoomRef.current;
    });

  // ── Pan to drag ──
  const lastPanRef = useRef({ x: 0, y: 0 });

  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .minPointers(1)
    .maxPointers(1)  // single-finger pan only; two-finger is pinch
    .onStart((event) => {
      lastPanRef.current = { x: event.x, y: event.y };
    })
    .onUpdate((event) => {
      const dx = event.x - lastPanRef.current.x;
      const dy = event.y - lastPanRef.current.y;
      lastPanRef.current = { x: event.x, y: event.y };

      const { halfFovH: hFovH, halfFovV: hFovV, baseDist: bDist, elevationAngle: elev } = camParamsRef.current;
      const zoom = zoomRef.current;
      // World units per pixel at current zoom
      const worldPerPxX = (2 * (bDist / zoom) * Math.tan(hFovH)) / camParamsRef.current.canvasWidth;
      const worldPerPxZ = (2 * (bDist / zoom) * Math.tan(hFovV)) / (Math.sin(elev) * camParamsRef.current.canvasHeight);

      targetRef.current = {
        x: targetRef.current.x - dx * worldPerPxX,
        z: targetRef.current.z - dy * worldPerPxZ,
      };
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  return (
    <View style={[styles.container, { width: canvasWidth, height: canvasHeight }]}>
      <Canvas
        camera={{ position: [camX, camY, camZ], fov, near: 0.1, far: 300 }}
      >
        <color attach="background" args={['#0D0305']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 10, 6]}  intensity={1.8} />
        <directionalLight position={[-3, 5, -4]} intensity={0.4} />
        <CameraController
          baseCamY={camY}
          baseCamZ={camZ}
          zoomRef={zoomRef}
          targetRef={targetRef}
        />
        <BarnScene
          data={points}
          cells={cells}
          longSide={longSide}
          shortSide={shortSide}
          boxH={boxH}
          swapped={swapped}
          startingCellId={startingCellId}
        />
      </Canvas>
      {/* Transparent overlay — must be a sibling AFTER Canvas, not a wrapper.
          On Android the Canvas intercepts native touches before RNGH can fire
          when it's a child of the GestureDetector. An absolute-fill View
          rendered on top captures all touches first.
          collapsable={false} is required on Android: without it the OS
          collapses empty Views and they never receive touch events. */}
      <GestureDetector gesture={composedGesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false} />
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0D0305',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#3A1015',
    alignSelf: 'center',
  },
});

export default SiloMapRectangle;