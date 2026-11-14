import * as THREE from 'three';

/**
 * Glass that shows its shape: nearly clear where you look straight through it, brighter and more opaque toward
 * the edges (a Fresnel rim), with the room's reflections on top. Cheap enough for phones: no refraction pass.
 */
export function glassMaterial(opts: { side?: THREE.Side; base?: number; rim?: number; tint?: number; env?: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.tint ?? 0xf2fbf8,
    transparent: true,
    opacity: opts.base ?? 0.08,
    roughness: 0.05,
    metalness: 0,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: false,
    envMapIntensity: opts.env ?? 3,
  });
  const rim = (opts.rim ?? 0.55).toFixed(3);
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
       diffuseColor.a = clamp(diffuseColor.a + fres * ${rim}, 0.0, 0.92);
       outgoingLight += vec3(1.0, 0.98, 0.94) * fres * ${rim} * 0.6;
       #include <opaque_fragment>`,
    );
  };
  mat.customProgramCacheKey = () => `glass-${rim}`;
  return mat;
}
