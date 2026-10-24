# Relative Rotation and Strength (RRG)

Amber Terminal provides an RRG-style rotation view as a documented approximation. It reuses the terminal's existing price sources and does not reproduce proprietary JdK values.

## Commands and universes

| Command | Contents |
|---|---|
| `RRG` or `RRG SECTORS` | Eleven US sector ETFs against SPY, weekly |
| `RRG LARGE` | A fixed list of large US stocks against SPY |
| `RRG WEI` | The terminal's 26 world indices, including VIX, against SPY |
| `RRG W` | Securities in the saved watchlist |
| `RRG PORT` | Each open holding in the saved portfolio, as a separate security |
| `RRG CUSTOM WEEKLY BENCH=SPY TAIL=8 AMAT,SAP.DE,OMV.VI` | A custom list and benchmark |
| Add `DAILY` | Use daily periods instead of weekly periods |

The screen also has controls for the benchmark, tail length and custom symbols. A chart line or ranking row opens that security's price chart. The ranking and error tables follow the terminal's CSV export behavior.

## Calculation

- Relative strength: `RS(t) = security close(t) / benchmark close(t)`, matched on date.
- Smoothed relative strength: `M(t) = SMA(RS, S)`.
- RS-Ratio: `100 × M(t) / SMA(M, B)`.
- RS-Momentum: `100 × RS-Ratio(t) / RS-Ratio(t−L)`.
- Weekly windows use `S=10`, `B=26`, `L=10`; daily windows use five times those lengths.
- The ranking uses Levy RSL: close divided by its 27-period weekly or 135-period daily moving average. RSL measures absolute strength, not strength against the benchmark.

Leading, Weakening, Lagging and Improving indicate the relation of the two coordinates to 100. A point on either 100 axis is Neutral. The trail is limited to the requested number of prior periods plus the latest point.

## Data and interpretation limits

Prices are matched by UTC calendar date; weekly periods use the benchmark's last available session in each calendar week. Missing sessions are not filled, and a gap interrupts the displayed tail. At least 45 consecutive aligned weekly periods or 229 daily periods are needed for the first point. The latest day or week may be incomplete. STALE means the last calculated security point is earlier than the latest benchmark period; Current means only that the dates match.

The view uses close prices without dividend reinvestment or currency conversion. Source adjustments and index return conventions can differ. VIX is a volatility index, not an equity market. For portfolio mode, each holding is shown separately: quantities, costs and weights are ignored, and short positions display the underlying security's price path rather than the short's return. Positions with zero or invalid share counts are omitted and duplicate securities appear once.

## Sorting

RRG and PORT tables sort by clicking a column heading. A new column starts ascending; clicking it again reverses the order. Numeric values use their unrounded values, missing numeric values stay last, and the initial RRG ranking is RSL descending. The chosen sort order is held in that panel for the current session. Sorting changes display order only; it does not reorder or modify saved portfolio holdings. Row actions, removal and CSV export use the displayed rows. Sort controls support keyboard focus and activation.

## Tests

Run the offline suite with `npm test`. The RRG regression tests cover input validation, formulas, date alignment, missing data, stale rows, universe selection, portfolio symbols, plots and sortable-table behavior.
