/**
 * A precomputed efficient frontier, shipped with the app.
 *
 * Solving across ~500 tickers takes minutes, so the portfolio builder renders
 * this baseline immediately and swaps in the live solve when it lands. It is
 * illustrative, not live market data — every surface that shows it must say so
 * (see the `isBaseline` flag threaded through the builder).
 *
 * Shape is identical to POST /api/efficient-frontier so the two are
 * interchangeable at the component boundary.
 */

export type EnvelopePoint = {
  t: number
  return: number
  volatility: number
  sharpe: number
}

export type Portfolio = {
  return: number
  volatility: number
  sharpe: number
  weights: Record<string, number>
}

export type CmlPoint = { volatility: number; return: number }

export type FrontierResponse = {
  short_allowed: boolean
  n_portfolios: number
  /** How many stocks the solve actually ran over. Absent on older responses. */
  n_assets?: number
  risk_free_rate: number
  max_sharpe: Portfolio
  min_volatility: Portfolio
  capital_market_line: CmlPoint[]
  envelope: EnvelopePoint[]
}

export const BASELINE_FRONTIER: FrontierResponse = {
  short_allowed: false,
  n_portfolios: 60,
  risk_free_rate: 0.0421,
  max_sharpe: {
    return: 0.156779,
    volatility: 0.124352,
    sharpe: 0.9222,
    weights: {
      AAPL: 0.0534,
      MSFT: 0.0658,
      NVDA: 0.0429,
      "BRK.B": 0.0782,
      JNJ: 0.0633,
      PG: 0.0579,
      XOM: 0.05,
      JPM: 0.0469,
      UNH: 0.0442,
      V: 0.0386,
      HD: 0.0351,
      MRK: 0.0342,
      KO: 0.0328,
      PEP: 0.0312,
      ABBV: 0.0297,
      CVX: 0.0282,
      LLY: 0.0267,
      COST: 0.0255,
      WMT: 0.0245,
      MCD: 0.0228,
      CSCO: 0.0212,
      ACN: 0.0197,
      TMO: 0.0192,
      ADBE: 0.0183,
      LIN: 0.0172,
      DHR: 0.0165,
      VZ: 0.0154,
      CMCSA: 0.0145,
      PM: 0.0135,
      NEE: 0.0127,
    },
  },
  min_volatility: {
    return: 0.0994,
    volatility: 0.0879,
    sharpe: 0.6519,
    weights: {
      AAPL: 0.0534,
      MSFT: 0.0658,
      NVDA: 0.0429,
      "BRK.B": 0.0782,
      JNJ: 0.0633,
      PG: 0.0579,
      XOM: 0.05,
      JPM: 0.0469,
      UNH: 0.0442,
      V: 0.0386,
      HD: 0.0351,
      MRK: 0.0342,
      KO: 0.0328,
      PEP: 0.0312,
      ABBV: 0.0297,
      CVX: 0.0282,
      LLY: 0.0267,
      COST: 0.0255,
      WMT: 0.0245,
      MCD: 0.0228,
      CSCO: 0.0212,
      ACN: 0.0197,
      TMO: 0.0192,
      ADBE: 0.0183,
      LIN: 0.0172,
      DHR: 0.0165,
      VZ: 0.0154,
      CMCSA: 0.0145,
      PM: 0.0135,
      NEE: 0.0127,
    },
  },
  capital_market_line: [
    { volatility: 0, return: 0.0421 },
    { volatility: 0.167291, return: 0.196378 },
  ],
  envelope: [
    { t: 0, return: 0.0994, volatility: 0.0879, sharpe: 0.6519 },
    { t: 0.016949, return: 0.10081, volatility: 0.087927, sharpe: 0.6677 },
    { t: 0.033898, return: 0.10222, volatility: 0.088006, sharpe: 0.6831 },
    { t: 0.050847, return: 0.103631, volatility: 0.088139, sharpe: 0.6981 },
    { t: 0.067797, return: 0.105041, volatility: 0.088324, sharpe: 0.7126 },
    { t: 0.084746, return: 0.106451, volatility: 0.088562, sharpe: 0.7266 },
    { t: 0.101695, return: 0.107861, volatility: 0.088852, sharpe: 0.7401 },
    { t: 0.118644, return: 0.109271, volatility: 0.089193, sharpe: 0.7531 },
    { t: 0.135593, return: 0.110681, volatility: 0.089585, sharpe: 0.7655 },
    { t: 0.152542, return: 0.112092, volatility: 0.090027, sharpe: 0.7774 },
    { t: 0.169492, return: 0.113502, volatility: 0.090519, sharpe: 0.7888 },
    { t: 0.186441, return: 0.114912, volatility: 0.09106, sharpe: 0.7996 },
    { t: 0.20339, return: 0.116322, volatility: 0.091648, sharpe: 0.8099 },
    { t: 0.220339, return: 0.117732, volatility: 0.092283, sharpe: 0.8196 },
    { t: 0.237288, return: 0.119142, volatility: 0.092964, sharpe: 0.8287 },
    { t: 0.254237, return: 0.120553, volatility: 0.09369, sharpe: 0.8374 },
    { t: 0.271186, return: 0.121963, volatility: 0.09446, sharpe: 0.8455 },
    { t: 0.288136, return: 0.123373, volatility: 0.095273, sharpe: 0.8531 },
    { t: 0.305085, return: 0.124783, volatility: 0.096128, sharpe: 0.8601 },
    { t: 0.322034, return: 0.126193, volatility: 0.097023, sharpe: 0.8667 },
    { t: 0.338983, return: 0.127603, volatility: 0.097958, sharpe: 0.8729 },
    { t: 0.355932, return: 0.129014, volatility: 0.098931, sharpe: 0.8785 },
    { t: 0.372881, return: 0.130424, volatility: 0.099941, sharpe: 0.8838 },
    { t: 0.389831, return: 0.131834, volatility: 0.100988, sharpe: 0.8886 },
    { t: 0.40678, return: 0.133244, volatility: 0.102069, sharpe: 0.893 },
    { t: 0.423729, return: 0.134654, volatility: 0.103185, sharpe: 0.897 },
    { t: 0.440678, return: 0.136064, volatility: 0.104333, sharpe: 0.9006 },
    { t: 0.457627, return: 0.137475, volatility: 0.105514, sharpe: 0.9039 },
    { t: 0.474576, return: 0.138885, volatility: 0.106725, sharpe: 0.9069 },
    { t: 0.491525, return: 0.140295, volatility: 0.107965, sharpe: 0.9095 },
    { t: 0.508475, return: 0.141705, volatility: 0.109235, sharpe: 0.9118 },
    { t: 0.525424, return: 0.143115, volatility: 0.110532, sharpe: 0.9139 },
    { t: 0.542373, return: 0.144525, volatility: 0.111856, sharpe: 0.9157 },
    { t: 0.559322, return: 0.145936, volatility: 0.113205, sharpe: 0.9172 },
    { t: 0.576271, return: 0.147346, volatility: 0.11458, sharpe: 0.9185 },
    { t: 0.59322, return: 0.148756, volatility: 0.115979, sharpe: 0.9196 },
    { t: 0.610169, return: 0.150166, volatility: 0.1174, sharpe: 0.9205 },
    { t: 0.627119, return: 0.151576, volatility: 0.118844, sharpe: 0.9212 },
    { t: 0.644068, return: 0.152986, volatility: 0.12031, sharpe: 0.9217 },
    { t: 0.661017, return: 0.154397, volatility: 0.121796, sharpe: 0.922 },
    { t: 0.677966, return: 0.155807, volatility: 0.123302, sharpe: 0.9222 },
    { t: 0.694915, return: 0.157217, volatility: 0.124828, sharpe: 0.9222 },
    { t: 0.711864, return: 0.158627, volatility: 0.126372, sharpe: 0.9221 },
    { t: 0.728814, return: 0.160037, volatility: 0.127934, sharpe: 0.9219 },
    { t: 0.745763, return: 0.161447, volatility: 0.129513, sharpe: 0.9215 },
    { t: 0.762712, return: 0.162858, volatility: 0.131109, sharpe: 0.921 },
    { t: 0.779661, return: 0.164268, volatility: 0.132721, sharpe: 0.9205 },
    { t: 0.79661, return: 0.165678, volatility: 0.134348, sharpe: 0.9198 },
    { t: 0.813559, return: 0.167088, volatility: 0.13599, sharpe: 0.9191 },
    { t: 0.830508, return: 0.168498, volatility: 0.137647, sharpe: 0.9183 },
    { t: 0.847458, return: 0.169908, volatility: 0.139317, sharpe: 0.9174 },
    { t: 0.864407, return: 0.171319, volatility: 0.141001, sharpe: 0.9164 },
    { t: 0.881356, return: 0.172729, volatility: 0.142698, sharpe: 0.9154 },
    { t: 0.898305, return: 0.174139, volatility: 0.144407, sharpe: 0.9144 },
    { t: 0.915254, return: 0.175549, volatility: 0.146128, sharpe: 0.9132 },
    { t: 0.932203, return: 0.176959, volatility: 0.14786, sharpe: 0.9121 },
    { t: 0.949153, return: 0.178369, volatility: 0.149604, sharpe: 0.9109 },
    { t: 0.966102, return: 0.17978, volatility: 0.151359, sharpe: 0.9096 },
    { t: 0.983051, return: 0.18119, volatility: 0.153124, sharpe: 0.9083 },
    { t: 1, return: 0.1826, volatility: 0.154899, sharpe: 0.907 },
  ],
}
