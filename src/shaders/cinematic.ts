import type { Texture } from "three";

// Pass de finition : grain animé + vignettage (aberration quasi nulle).
export const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0.05 },
    uResolution: { value: [1, 1] as [number, number] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p){
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main(){
      vec3 col = texture2D(tDiffuse, vUv).rgb;

      // grain animé
      float g = hash(vUv * uResolution + uTime * 60.0) - 0.5;
      col += g * uGrain;

      // vignettage
      float d = distance(vUv, vec2(0.5));
      col *= mix(0.6, 1.0, smoothstep(0.9, 0.2, d));

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
