// Small animated SVG weather icon by category. Animations are CSS keyframes
// scoped to a unique class; all respect prefers-reduced-motion.
export default function WeatherIcon({ category = 'cloud', size = 30 }) {
  const cloud = (
    <path className="wi-cloud" d="M8 20 a5 5 0 0 1 1-9.9 a7 7 0 0 1 13 2 a4.5 4.5 0 0 1 -1 9 Z"
      fill="#c7d0d8" stroke="#aab4bd" strokeWidth="0.6" />
  )
  return (
    <svg className={'wi wi-' + category} width={size} height={size} viewBox="0 0 36 36" role="img" aria-hidden="true">
      {category === 'clear' && (
        <g className="wi-sun">
          <g className="wi-rays" stroke="#FFC83D" strokeWidth="2.4" strokeLinecap="round">
            <line x1="18" y1="3" x2="18" y2="8" /><line x1="18" y1="28" x2="18" y2="33" />
            <line x1="3" y1="18" x2="8" y2="18" /><line x1="28" y1="18" x2="33" y2="18" />
            <line x1="7" y1="7" x2="10.5" y2="10.5" /><line x1="25.5" y1="25.5" x2="29" y2="29" />
            <line x1="29" y1="7" x2="25.5" y2="10.5" /><line x1="10.5" y1="25.5" x2="7" y2="29" />
          </g>
          <circle cx="18" cy="18" r="7" fill="#FFC83D" />
        </g>
      )}
      {category === 'partly' && (<g>
        <g className="wi-sun"><circle cx="13" cy="13" r="6" fill="#FFC83D" /></g>{cloud}
      </g>)}
      {category === 'cloud' && cloud}
      {category === 'fog' && (<g>{cloud}
        <g className="wi-fog" stroke="#aab4bd" strokeWidth="2" strokeLinecap="round">
          <line x1="9" y1="26" x2="27" y2="26" /><line x1="11" y1="30" x2="25" y2="30" />
        </g></g>)}
      {category === 'rain' && (<g>{cloud}
        <g className="wi-rain" stroke="#5BA4E6" strokeWidth="2.2" strokeLinecap="round">
          <line className="d1" x1="12" y1="24" x2="11" y2="29" />
          <line className="d2" x1="18" y1="24" x2="17" y2="29" />
          <line className="d3" x1="24" y1="24" x2="23" y2="29" />
        </g></g>)}
      {category === 'snow' && (<g>{cloud}
        <g className="wi-snow" fill="#dff1ff">
          <circle className="d1" cx="12" cy="27" r="1.6" /><circle className="d2" cx="18" cy="27" r="1.6" /><circle className="d3" cx="24" cy="27" r="1.6" />
        </g></g>)}
      {category === 'storm' && (<g>{cloud}
        <path className="wi-bolt" d="M18 22 L14 30 H18 L15 35 L23 27 H19 L22 22 Z" fill="#FFC83D" stroke="#e0a91f" strokeWidth="0.5" />
      </g>)}

      <style>{`
        .wi-cloud { animation: wi-drift 4s var(--ease) infinite; }
        .wi-rays { transform-origin: 18px 18px; animation: wi-spin 9s linear infinite; }
        .wi-sun circle { animation: wi-pulse 3s var(--ease) infinite; }
        .wi-rain line, .wi-snow circle { animation: wi-fall 1.1s linear infinite; }
        .wi-rain .d2, .wi-snow .d2 { animation-delay: .25s; }
        .wi-rain .d3, .wi-snow .d3 { animation-delay: .5s; }
        .wi-bolt { animation: wi-flash 2.2s steps(1) infinite; }
        @keyframes wi-spin { to { transform: rotate(360deg); } }
        @keyframes wi-pulse { 0%,100%{ transform: scale(1) } 50%{ transform: scale(1.08) } }
        @keyframes wi-drift { 0%,100%{ transform: translateX(0) } 50%{ transform: translateX(1.5px) } }
        @keyframes wi-fall { 0%{ opacity:0; transform: translateY(-3px) } 30%{ opacity:1 } 100%{ opacity:0; transform: translateY(4px) } }
        @keyframes wi-flash { 0%,92%,100%{ opacity:1 } 94%{ opacity:.15 } 96%{ opacity:1 } 98%{ opacity:.15 } }
        @media (prefers-reduced-motion: reduce) { .wi * { animation: none !important; } }
      `}</style>
    </svg>
  )
}
