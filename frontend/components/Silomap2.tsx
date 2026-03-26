import React, { useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import * as THREE from 'three';

type HeatPoint = { x: number; y: number; z: number; temp: number };

const SURFACE_Y = 2.9;

/**
 * Internal Scene component to handle 3D rendering
 */
function SiloScene({ data }: { data: HeatPoint[] }) {
  const latest = data[data.length - 1];

  return (
    <group>
      {/* The Silo Hull - Consistent with robot.tsx */}
      <mesh>
        <cylinderGeometry args={[2, 2, 6, 32]} />
        <meshStandardMaterial 
          color="#5AFF8A" 
          transparent 
          opacity={0.1} 
          wireframe 
        />
      </mesh>
      
      {/* Historical Data Points */}
      {data.map((point, i) => (
        <mesh key={i} position={[point.x, point.y, point.z]}>
          <sphereGeometry args={[0.15]} />
          <meshStandardMaterial 
            color={point.temp > 30 ? "#FF4B5F" : "#5AFF8A"} 
            emissive={point.temp > 30 ? "#FF4B5F" : "#5AFF8A"}
            emissiveIntensity={0.5}
          />
        </mesh>
      ))}

      {/* Live Robot Marker */}
      {latest && (
        <mesh position={[latest.x, SURFACE_Y + 0.08, latest.z]}>
          <sphereGeometry args={[0.22]} />
          <meshStandardMaterial color="#00D5FF" emissive="#00D5FF" emissiveIntensity={1} />
        </mesh>
      )}
    </group>
  );
}

/**
 * Reusable Tactical Map Component
 * Pass in 'points' array from any screen
 */
const SiloMap = ({ points = [] }: { points: HeatPoint[] }) => {
  return (
    <View style={styles.container}>
      <Canvas camera={{ position: [0, 8, 8], fov: 45 }}>
        <color attach="background" args={['#050505']} />
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={2} />
        <SiloScene data={points} />
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 450,
    width: '100%',
    backgroundColor: '#111',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1A1D21',
  },
});

export default SiloMap;