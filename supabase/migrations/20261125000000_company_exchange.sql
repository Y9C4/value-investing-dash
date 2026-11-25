-- Listing exchange joins the rest of the company profile, shown on the stock
-- page as "NYSE: DVA". It and in_universe are type 1: the daily price job
-- overwrites them (python-api/membership.py).
alter table raw.company_profile add column if not exists exchange text;

comment on column raw.company_profile.in_universe is
  'S&P 500 member today, kept by the daily price job. A company that leaves keeps its history.';

-- Values as of this migration, so the page has them before the next price run.
update raw.company_profile c
set exchange = seed.exchange
from (values
  ('Cboe', '{CBOE}'::text[]),
  ('NASDAQ', '{AAPL,ABNB,ACGL,ADBE,ADI,ADP,ADSK,AEP,AKAM,ALGN,AMAT,AMD,AMGN,AMZN,APA,APP,AVGO,AXON,BIIB,BKNG,BKR,CASY,CDNS,CDW,CEG,CHRW,CHTR,CINF,CMCSA,CME,COIN,COO,COST,CPRT,CRWD,CSCO,CSGP,CSX,CTAS,CTSH,DASH,DDOG,DLTR,DPZ,DXCM,EBAY,ECHO,EQIX,ERIE,EVRG,EXC,EXE,EXPE,FANG,FAST,FFIV,FISV,FLEX,FOX,FOXA,FSLR,FTNT,GEHC,GEN,GILD,GM,GOOG,GOOGL,HAS,HBAN,HLT,HON,HONA,HOOD,HSIC,HST,IBKR,IDXX,INCY,INTC,INTU,ISRG,JBHT,JKHY,KDP,KLAC,KMB,LIN,LITE,LNT,LRCX,LULU,MAR,MCHP,MDLZ,META,MNST,MPWR,MRNA,MRVL,MSFT,MU,NDAQ,NDSN,NFLX,NTAP,NTRS,NVDA,NWS,NWSA,NXPI,ODFL,ON,ORLY,PANW,PAYX,PCAR,PEP,PFG,PLTR,PODD,PTC,PYPL,QCOM,REG,REGN,ROP,ROST,SBAC,SBUX,SMCI,SNDK,SNPS,STLD,STX,SWKS,TECH,TER,TMUS,TRMB,TROW,TSCO,TSLA,TTD,TTWO,TXN,UAL,ULTA,VRSK,VRSN,VRTX,VTRS,WDAY,WDC,WMT,WTW,WYNN,XEL,ZBRA}'::text[]),
  ('NYSE', '{A,ABBV,ABT,ACN,ADM,AEE,AES,AFL,AIG,AIZ,AJG,ALB,ALL,ALLE,AMCR,AME,AMP,AMT,ANET,AON,AOS,APD,APH,APO,APTV,ARE,ARES,ATO,AVY,AWK,AXP,AZO,BA,BAC,BALL,BAX,BBY,BDX,BEN,BF-B,BG,BLDR,BLK,BMY,BNY,BR,BRK-B,BRO,BSX,BX,BXP,C,CAH,CARR,CAT,CB,CBRE,CCI,CCL,CF,CFG,CHD,CI,CIEN,CL,CLX,CMG,CMI,CMS,CNC,CNP,COF,COHR,COP,COR,CPAY,CPT,CRH,CRL,CRM,CTVA,CVNA,CVS,CVX,D,DAL,DD,DE,DECK,DELL,DG,DGX,DHI,DHR,DIS,DLR,DOC,DOV,DOW,DRI,DTE,DUK,DVA,DVN,ECL,ED,EFX,EG,EIX,EL,ELV,EME,EMR,EOG,EQT,ES,ESS,ETN,ETR,EW,EXPD,EXR,F,FCX,FDS,FDX,FDXF,FE,FERG,FICO,FIS,FITB,FIX,FRT,FTV,GD,GDDY,GE,GEV,GIS,GL,GLW,GNRC,GPC,GPN,GRMN,GS,GWW,HAL,HCA,HD,HIG,HII,HPE,HPQ,HRL,HSY,HUBB,HUM,HWM,IBM,ICE,IEX,IFF,INVH,IP,IQV,IR,IRM,IT,ITW,IVZ,J,JBL,JCI,JNJ,JPM,KEY,KEYS,KHC,KIM,KKR,KMI,KO,KR,L,LDOS,LEN,LH,LHX,LII,LLY,LMT,LOW,LUV,LVS,LYB,LYV,MA,MAA,MAS,MCD,MCK,MCO,MDT,MET,MGM,MKC,MLM,MMM,MO,MOS,MPC,MRK,MRSH,MS,MSCI,MSI,MTB,MTD,NCLH,NEE,NEM,NI,NKE,NOC,NOW,NRG,NSC,NUE,NVR,O,OKE,OMC,ORCL,OTIS,OXY,PCG,PEG,PFE,PG,PGR,PH,PHM,PKG,PLD,PM,PNC,PNR,PNW,PPG,PPL,PRU,PSA,PSX,PWR,Q,RCL,RF,RJF,RL,RMD,ROK,ROL,RSG,RTX,RVTY,SCHW,SHW,SJM,SLB,SNA,SO,SOLV,SPG,SPGI,SRE,STE,STT,STZ,SW,SWK,SYF,SYK,SYY,T,TAP,TDG,TDY,TEL,TFC,TGT,TJX,TKO,TMO,TPL,TPR,TRGP,TRV,TSN,TT,TXT,TYL,UBER,UDR,UHS,UNH,UNP,UPS,URI,USB,V,VEEV,VICI,VLO,VLTO,VMC,VRT,VST,VTR,VZ,WAB,WAT,WEC,WELL,WFC,WM,WMB,WRB,WSM,WST,WY,XOM,XYL,XYZ,YUM,ZBH,ZTS}'::text[])
) as seed(exchange, tickers)
where c.ticker = any(seed.tickers);

-- The screener is security_invoker, so its reader needs these two columns.
grant select (ticker, exchange) on raw.company_profile to anon, authenticated;

-- Joined here rather than carried through the materialised views: nothing is
-- derived from it. Any later rebuild of this view must keep the join.
create or replace view public.screener
with (security_invoker = true) as
select
  s.ticker,
  s.name,
  s.sector,
  s.as_of,
  s.price,
  s.market_cap_bn,
  s.beta,
  s.realised_return,
  s.volatility,
  s.pe_ratio,
  s.dividend_yield,
  s.fcf_yield,
  s.ev_ebitda,
  s.pb_ratio,
  s.shareholder_yield,
  s.roe,
  s.revenue_growth,
  s.revenue_bn,
  s.discount_rates,
  s.signals,
  c.exchange
from warehouse.stock_snapshot s
left join raw.company_profile c on c.ticker = s.ticker;
