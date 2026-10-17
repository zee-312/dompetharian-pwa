'use client';

/**
 * DompetHarian — Brand Logo Component (Warm Tactile Editorial Edition)
 * Concept: Geometric Origami Wallet forming the letter 'D' + Golden Coin (#D99B26) + Sage Leaf Sprout (#2E5A44)
 * Author / Credit: Aravajordan
 */

import React from 'react';

interface BrandLogoProps {
  size?: number;
  className?: string;
  variant?: 'tile' | 'mark-only';
}

export function BrandLogo({
  size = 38,
  className = '',
  variant = 'tile',
}: BrandLogoProps) {
  if (variant === 'mark-only') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        {/* Golden Coin tucked inside top pocket */}
        <circle cx="66" cy="24" r="16" fill="#D99B26" />
        <circle
          cx="66"
          cy="24"
          r="11.5"
          fill="none"
          stroke="#FAF7F2"
          strokeWidth="1.8"
          strokeDasharray="3 2.5"
          opacity="0.85"
        />
        {/* Sage Leaf Sprout emerging from right of coin */}
        <path
          d="M 80 24 C 80 10, 98 8, 102 18 C 94 26, 84 26, 80 24 Z"
          fill="#2E5A44"
        />
        <path
          d="M 82 23 C 88 18, 94 16, 100 18"
          stroke="#A3D9B8"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        {/* Main Origami 'D' Wallet Body (Left Spine + Curved Belly) */}
        <path
          d="M 18 24 C 18 19.5, 21.5 16, 26 16 L 40 16 L 40 104 L 26 104 C 21.5 104, 18 100.5, 18 96 Z"
          fill="#2E5A44"
        />
        <path
          d="M 44 26 L 68 26 C 92 26, 106 42, 106 65 C 106 88, 92 104, 68 104 L 44 104 Z"
          fill="#1E402F"
        />
        {/* Warm Terracotta Clasp Fold */}
        <path
          d="M 44 48 L 86 48 C 93 48, 98 53, 98 60 L 98 68 C 98 75, 93 80, 86 80 L 62 80 C 52 80, 44 72, 44 62 Z"
          fill="#C85A32"
        />
        {/* Inner Counter Aperture of the 'D' */}
        <path
          d="M 44 38 L 64 38 C 79 38, 88 49, 88 65 C 88 81, 79 92, 64 92 L 44 92 Z"
          fill="#FAF7F2"
          opacity="0.16"
        />
        {/* Brass Snap Button */}
        <circle cx="80" cy="64" r="5.5" fill="#FAF7F2" />
        <circle cx="80" cy="64" r="2.8" fill="#D99B26" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {/* Tactile Espresso & Sage Tile Container */}
      <rect
        x="2"
        y="2"
        width="116"
        height="116"
        rx="28"
        fill="#1E3529"
        stroke="#D8CEBE"
        strokeWidth="2"
      />
      <rect
        x="7"
        y="7"
        width="106"
        height="106"
        rx="23"
        fill="none"
        stroke="#FAF7F2"
        strokeWidth="1.2"
        strokeDasharray="4 4"
        opacity="0.22"
      />

      {/* Golden Coin tucked inside top pocket */}
      <circle cx="64" cy="27" r="14.5" fill="#D99B26" />
      <circle
        cx="64"
        cy="27"
        r="10"
        fill="none"
        stroke="#FAF7F2"
        strokeWidth="1.5"
        strokeDasharray="3 2.5"
        opacity="0.85"
      />

      {/* Sage Leaf Sprout */}
      <path
        d="M 76 26 C 77 14, 93 12, 97 21 C 90 28, 81 28, 76 26 Z"
        fill="#69B58C"
      />
      <path
        d="M 78 25 C 83 20, 89 19, 95 21"
        stroke="#FAF7F2"
        strokeWidth="1.4"
        strokeLinecap="round"
      />

      {/* Origami 'D' Left Spine */}
      <rect x="23" y="24" width="16" height="72" rx="6" fill="#FAF7F2" />

      {/* Origami 'D' Right Curved Pocket Body */}
      <path
        d="M 43 32 L 64 32 C 84 32, 96 45, 96 64 C 96 83, 84 96, 64 96 L 43 96 Z"
        fill="#FAF7F2"
      />

      {/* Inner D Counter Cutout */}
      <path
        d="M 43 44 L 61 44 C 73 44, 81 52, 81 64 C 81 76, 73 84, 61 84 L 43 84 Z"
        fill="#1E3529"
      />

      {/* Warm Terracotta Clasp Strap */}
      <rect x="58" y="55" width="38" height="18" rx="9" fill="#C85A32" />
      <circle cx="85" cy="64" r="4.5" fill="#FAF7F2" />
      <circle cx="85" cy="64" r="2.2" fill="#D99B26" />
    </svg>
  );
}
