// src/data/players.js
// Minimal but richer starter dataset with names, positions, teams, and projections.
// You can freely expand this list later; keep ids as strings.

const players = [
  // QBs
  { id: "QB001", name: "Patrick Mahomes", position: "QB", team: "KC",
    projections: { "1": 24.1, "2": 22.8, "3": 23.4 } },
  { id: "QB002", name: "Josh Allen", position: "QB", team: "BUF",
    projections: { "1": 23.0, "2": 23.7, "3": 22.9 } },
  { id: "QB003", name: "Jalen Hurts", position: "QB", team: "PHI",
    projections: { "1": 22.4, "2": 22.0, "3": 23.2 } },
  { id: "QB004", name: "Lamar Jackson", position: "QB", team: "BAL",
    projections: { "1": 21.8, "2": 22.1, "3": 21.5 } },

  // RBs
  { id: "RB001", name: "Christian McCaffrey", position: "RB", team: "SF",
    projections: { "1": 21.3, "2": 20.7, "3": 21.1 } },
  { id: "RB002", name: "Bijan Robinson", position: "RB", team: "ATL",
    projections: { "1": 16.9, "2": 17.2, "3": 16.3 } },
  { id: "RB003", name: "Jonathan Taylor", position: "RB", team: "IND",
    projections: { "1": 16.1, "2": 15.6, "3": 16.5 } },
  { id: "RB004", name: "Saquon Barkley", position: "RB", team: "PHI",
    projections: { "1": 15.8, "2": 16.0, "3": 15.2 } },
  { id: "RB005", name: "Breece Hall", position: "RB", team: "NYJ",
    projections: { "1": 15.1, "2": 15.4, "3": 15.8 } },
  { id: "RB006", name: "Derrick Henry", position: "RB", team: "BAL",
    projections: { "1": 14.9, "2": 14.5, "3": 14.7 } },

  // WRs
  { id: "WR001", name: "Justin Jefferson", position: "WR", team: "MIN",
    projections: { "1": 19.7, "2": 20.1, "3": 19.0 } },
  { id: "WR002", name: "Ja'Marr Chase", position: "WR", team: "CIN",
    projections: { "1": 18.8, "2": 18.5, "3": 19.2 } },
  { id: "WR003", name: "Tyreek Hill", position: "WR", team: "MIA",
    projections: { "1": 20.3, "2": 19.6, "3": 20.0 } },
  { id: "WR004", name: "Amon-Ra St. Brown", position: "WR", team: "DET",
    projections: { "1": 17.9, "2": 18.2, "3": 17.4 } },
  { id: "WR005", name: "CeeDee Lamb", position: "WR", team: "DAL",
    projections: { "1": 18.0, "2": 17.5, "3": 18.1 } },
  { id: "WR006", name: "Stefon Diggs", position: "WR", team: "HOU",
    projections: { "1": 16.3, "2": 16.9, "3": 16.0 } },
  { id: "WR007", name: "A.J. Brown", position: "WR", team: "PHI",
    projections: { "1": 17.2, "2": 17.0, "3": 17.1 } },
  { id: "WR008", name: "Puka Nacua", position: "WR", team: "LAR",
    projections: { "1": 16.0, "2": 15.5, "3": 15.8 } },

  // TEs
  { id: "TE001", name: "Travis Kelce", position: "TE", team: "KC",
    projections: { "1": 16.4, "2": 15.9, "3": 16.2 } },
  { id: "TE002", name: "Mark Andrews", position: "TE", team: "BAL",
    projections: { "1": 13.8, "2": 13.5, "3": 13.9 } },
  { id: "TE003", name: "Sam LaPorta", position: "TE", team: "DET",
    projections: { "1": 12.9, "2": 12.4, "3": 12.7 } },
  { id: "TE004", name: "George Kittle", position: "TE", team: "SF",
    projections: { "1": 12.0, "2": 12.6, "3": 11.8 } },

  // Ks
  { id: "K001", name: "Justin Tucker", position: "K", team: "BAL",
    projections: { "1": 9.1, "2": 9.0, "3": 8.8 } },
  { id: "K002", name: "Harrison Butker", position: "K", team: "KC",
    projections: { "1": 8.7, "2": 8.9, "3": 9.0 } },
  { id: "K003", name: "Jake Elliott", position: "K", team: "PHI",
    projections: { "1": 8.0, "2": 8.2, "3": 8.1 } },
  { id: "K004", name: "Evan McPherson", position: "K", team: "CIN",
    projections: { "1": 7.8, "2": 7.9, "3": 8.0 } },

  // DEF
  { id: "DEF001", name: "49ers D/ST", position: "DEF", team: "SF",
    projections: { "1": 8.5, "2": 7.9, "3": 8.1 } },
  { id: "DEF002", name: "Cowboys D/ST", position: "DEF", team: "DAL",
    projections: { "1": 8.2, "2": 8.0, "3": 7.7 } },
  { id: "DEF003", name: "Ravens D/ST", position: "DEF", team: "BAL",
    projections: { "1": 7.9, "2": 7.8, "3": 7.6 } },
  { id: "DEF004", name: "Eagles D/ST", position: "DEF", team: "PHI",
    projections: { "1": 7.6, "2": 7.5, "3": 7.4 } },

  // More depth so a few benches fill out
  { id: "RB007", name: "Kyren Williams", position: "RB", team: "LAR",
    projections: { "1": 14.6, "2": 14.4, "3": 14.7 } },
  { id: "RB008", name: "Josh Jacobs", position: "RB", team: "GB",
    projections: { "1": 14.2, "2": 13.8, "3": 14.0 } },
  { id: "WR009", name: "Amon Davis (Test)", position: "WR", team: "FA",
    projections: { "1": 8.0, "2": 8.2, "3": 8.1 } },
  { id: "WR010", name: "Mike Evans", position: "WR", team: "TB",
    projections: { "1": 14.0, "2": 13.7, "3": 13.9 } },
  { id: "WR011", name: "Garrett Wilson", position: "WR", team: "NYJ",
    projections: { "1": 15.0, "2": 15.2, "3": 14.8 } },
  { id: "QB005", name: "Joe Burrow", position: "QB", team: "CIN",
    projections: { "1": 19.0, "2": 20.1, "3": 19.6 } },
  { id: "QB006", name: "C.J. Stroud", position: "QB", team: "HOU",
    projections: { "1": 19.3, "2": 19.7, "3": 19.9 } },
  { id: "TE005", name: "T.J. Hockenson", position: "TE", team: "MIN",
    projections: { "1": 12.1, "2": 12.3, "3": 12.0 } },
  { id: "K005", name: "Brandon Aubrey", position: "K", team: "DAL",
    projections: { "1": 8.4, "2": 8.5, "3": 8.6 } },
  { id: "DEF005", name: "Jets D/ST", position: "DEF", team: "NYJ",
    projections: { "1": 7.5, "2": 7.7, "3": 7.8 } },
];

export default players;
