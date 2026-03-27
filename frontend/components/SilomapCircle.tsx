import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import * as THREE from 'three';

type HeatPoint = { x: number; y: number; z: number; temp: number };

const SURFACE_Y = 2.9;

function SiloSurfaceCells({ diameter }: { diameter: number }) {
  // Multiply by SCALE if you use it, otherwise use diameter directly
  const radius = diameter / 2; 
  return (
    <group position={[0, SURFACE_Y + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <ringGeometry args={[0, radius, 32]} />
        <meshStandardMaterial 
          color="#1A3020" 
          transparent 
          opacity={0.7} 
          emissive="#3DFF80"
          emissiveIntensity={0.1}
        />
      </mesh>
      {/* 10 divisions on the grid makes it look like a tactical map */}
      <gridHelper args={[radius * 2, 10, '#3DFF80', '#1A3020']} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}

const SiloMapCircle = ({ points = [], hangar = null }: { points: HeatPoint[], hangar?: any }) => {
  const diameter = hangar?.diameter ?? 5; // Default to 5m if not set
  const latest = points[points.length - 1];

  return (
    <View style={styles.container}>
      <Canvas camera={{ position: [0, 8, 8], fov: 45 }}>
        <color attach="background" args={['#050505']} />
        <ambientLight intensity={0.6} />
        <pointLight position={[10, 10, 10]} intensity={2} />
        
        <group>
          {/* 1. The Grid Surface */}
          <SiloSurfaceCells diameter={diameter} />

          {/* 2. The Transparent Hull */}
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[diameter/2, diameter/2, 6, 32]} />
            <meshStandardMaterial color="#5AFF8A" transparent opacity={0.1} wireframe />
          </mesh>
          
          {/* 3. The Heat Trail (Historical Points) */}
          {points.map((p, i) => (
            <mesh key={i} position={[p.x, p.y, p.z]}>
              <sphereGeometry args={[0.12]} />
              <meshStandardMaterial 
                color={p.temp > 30 ? "#FF4B5F" : "#5AFF8A"} 
                emissive={p.temp > 30 ? "#FF4B5F" : "#5AFF8A"}
                emissiveIntensity={0.5}
              />
            </mesh>
          ))}

          {/* 4. The Live Robot Cursor */}
          {latest && (
            <mesh position={[latest.x, SURFACE_Y + 0.1, latest.z]}>
              <sphereGeometry args={[0.22]} />
              <meshStandardMaterial color="#00D5FF" emissive="#00D5FF" emissiveIntensity={2} />
            </mesh>
          )}
        </group>
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 450,
    width: '100%',
    backgroundColor: '#050505',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1A3020',
  },
});

export default SiloMapCircle;