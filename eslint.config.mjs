import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

/**
 * React Compiler 계열 규칙(`react-hooks/set-state-in-effect`,
 * `react-hooks/immutability`)을 이미 위반하고 있는 파일들.
 *
 * **규칙을 끄지 않고 이 목록에만 경고로 낮춘다.** 새로 쓰는 코드는 그대로
 * 에러라서 빚이 늘지 않고, CI는 첫날부터 초록불이 된다.
 *
 * 여기 있는 것들은 effect 안에서 동기적으로 setState를 부르는 형태라
 * 고치려면 effect 구조를 바꿔야 하는데, 피드·플레이어 훅은
 * ENGINEERING-LOG에 적힌 재생/스와이프 회귀와 직결된다.
 * 실기기 검증 없이 건드리지 않는다. 목록을 줄이는 것이 목표다.
 */
const REACT_COMPILER_DEBT = [
  "src/app/(dashboard)/dashboard/page.tsx",
  "src/domains/donation/components/DonationAlert.tsx",
  "src/domains/donation/components/DonationHistory.tsx",
  "src/domains/donation/hooks/useDonation.ts",
  "src/domains/stream/hooks/useFeed.ts",
  "src/domains/stream/hooks/useWebRTC.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    files: REACT_COMPILER_DEBT,
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
