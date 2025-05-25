function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('SpartanOdds')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

function buscarJogosOrdenadosPorDataBrasileira() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("SpartanOdds") || ss.insertSheet("SpartanOdds");
  
  // Limpa e prepara o cabeçalho (12 colunas)
  sheet.clear();
  sheet.appendRow([
    'Campeonato', 'Data (Brasília)', 'Hora (Brasília)', 
    'Time Casa', 'Time Fora', 'Odd Casa', 'Odd Empate', 'Odd Fora',
    'Prob. Casa (%)', 'Prob. Empate (%)', 'Prob. Fora (%)', 'Aposta Sugerida'
  ]);

  const apiKey = getApiKey();
  
  // Ligas selecionadas
  const ligas = [
    { key: 'soccer_brazil_campeonato', nome: 'Brasileirão Série A', regiao: 'eu' },
    { key: 'soccer_brazil_serie_b', nome: 'Brasileirão Série B', regiao: 'eu' },
    { key: 'soccer_epl', nome: 'Premier League', regiao: 'eu' },
    { key: 'soccer_spain_la_liga', nome: 'La Liga', regiao: 'eu' },
    { key: 'soccer_italy_serie_a', nome: 'Serie A', regiao: 'eu' },
    { key: 'soccer_france_ligue_one', nome: 'Ligue 1', regiao: 'eu' },
    { key: 'soccer_germany_bundesliga', nome: 'Bundesliga', regiao: 'eu' }
  ];

  // Configuração de datas
  const hoje = new Date();
  const amanha = new Date(hoje);
  amanha.setDate(hoje.getDate() + 1);
  
  const formatarDataAPI = date => Utilities.formatDate(date, 'GMT', "yyyy-MM-dd");
  const [dataHoje, dataAmanha] = [hoje, amanha].map(formatarDataAPI);

  // Formatação para horário de Brasília
  const formatarDataHoraBrasilia = (isoString) => {
    try {
      const data = new Date(isoString);
      const options = { 
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      };
      
      const [dataFormatada, horaFormatada] = data.toLocaleString('pt-BR', options).split(', ');
      return { data: dataFormatada, hora: horaFormatada };
    } catch (e) {
      return { data: '-', hora: '-' };
    }
  };

  // Coleta todos os jogos
  let todosJogos = [];
  
  ligas.forEach(liga => {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${liga.key}/odds/?apiKey=${apiKey}&regions=${liga.regiao}&markets=h2h&oddsFormat=decimal`;
      const response = fetchWithRetry(url, { 
        muteHttpExceptions: true,
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });
      
      if (response.getResponseCode() !== 200) {
        Logger.log(`Erro na liga ${liga.nome}: ${response.getContentText()}`);
        return;
      }

      const jogos = JSON.parse(response.getContentText());
      if (!Array.isArray(jogos)) return;

      jogos.forEach(jogo => {
        try {
          const dataJogo = jogo.commence_time?.split('T')[0];
          if (![dataHoje, dataAmanha].includes(dataJogo)) return;

          if (!jogo.bookmakers || jogo.bookmakers.length === 0) return;
          
          const bookmaker = jogo.bookmakers.find(b => b.markets?.some(m => m.key === 'h2h'));
          if (!bookmaker) return;
          
          const market = bookmaker.markets.find(m => m.key === 'h2h');
          if (!market?.outcomes || market.outcomes.length < 3) return;

          const outcomes = market.outcomes;
          
          const oddCasa = outcomes.find(o => o.name.toLowerCase() === jogo.home_team.toLowerCase())?.price;
          const oddEmpate = outcomes.find(o => o.name.toLowerCase() === 'draw')?.price;
          const oddFora = outcomes.find(o => o.name.toLowerCase() === jogo.away_team.toLowerCase())?.price;

          if (!oddCasa || !oddEmpate || !oddFora) return;

          const probCasa = (1 / oddCasa) * 100;
          const probEmpate = (1 / oddEmpate) * 100;
          const probFora = (1 / oddFora) * 100;
          
          const probMaxima = Math.max(probCasa, probEmpate, probFora);

          if (probMaxima >= 70) {
            todosJogos.push({
              campeonato: liga.nome,
              dataHoraUTC: jogo.commence_time,
              timeCasa: jogo.home_team,
              timeFora: jogo.away_team,
              oddCasa: parseFloat(oddCasa.toFixed(2)),
              oddEmpate: parseFloat(oddEmpate.toFixed(2)),
              oddFora: parseFloat(oddFora.toFixed(2)),
              probCasa: parseFloat(probCasa.toFixed(2)),
              probEmpate: parseFloat(probEmpate.toFixed(2)),
              probFora: parseFloat(probFora.toFixed(2)),
              apostaSugerida: probMaxima === probCasa ? jogo.home_team :
                             probMaxima === probEmpate ? 'Empate' : jogo.away_team
            });
          }
        } catch (e) {
          Logger.log(`Erro ao processar jogo: ${e.message}`);
        }
      });
    } catch (e) {
      Logger.log(`Erro na liga ${liga.nome}: ${e.message}`);
    }
  });

  // Ordena por data
  todosJogos.sort((a, b) => new Date(a.dataHoraUTC) - new Date(b.dataHoraUTC));

  // Processa resultados
  if (todosJogos.length === 0) {
    const mensagem = `Nenhum jogo com probabilidade ≥70% encontrado para ${dataHoje} ou ${dataAmanha}`;
    sheet.getRange(2, 1, 1, 12).setValues([[mensagem, '', '', '', '', '', '', '', '', '', '', '']]);
    return mensagem;
  }

  // Prepara dados para inserção
  const dadosFormatados = todosJogos.map(jogo => {
    const { data, hora } = formatarDataHoraBrasilia(jogo.dataHoraUTC);
    return [
      jogo.campeonato,
      data,
      hora,
      jogo.timeCasa,
      jogo.timeFora,
      jogo.oddCasa,
      jogo.oddEmpate,
      jogo.oddFora,
      jogo.probCasa,
      jogo.probEmpate,
      jogo.probFora,
      jogo.apostaSugerida
    ];
  });

  // Insere dados
  const range = sheet.getRange(2, 1, dadosFormatados.length, 12);
  range.setValues(dadosFormatados);
  
  // Formata probabilidades altas
  const formatacoes = dadosFormatados.map(row => [
    row[8] >= 70 ? 'green' : null,
    row[9] >= 70 ? 'green' : null,
    row[10] >= 70 ? 'green' : null
  ]);
  
  range.offset(0, 8, dadosFormatados.length, 3).setFontColors(formatacoes);

  return `Atualizado com ${todosJogos.length} jogos.`;
}

function obterJogos() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error("Nenhuma planilha ativa encontrada");

    const planilha = ss.getSheetByName("SpartanOdds");
    if (!planilha) throw new Error("Aba 'SpartanOdds' não encontrada");

    const [cabecalho, ...linhas] = planilha.getDataRange().getValues();
    if (linhas.length === 0) return {status: "empty", message: "Nenhum dado encontrado"};

    const jogos = linhas.map(linha => {
      if (!linha[0]) return null;
      
      return {
        campeonato: linha[0] || "-",
        data: formatarData(linha[1]),
        hora: formatarHora(linha[2]),
        timeCasa: linha[3] || "-",
        timeFora: linha[4] || "-",
        oddCasa: linha[5] ? parseFloat(linha[5]).toFixed(2) : "-",
        oddEmpate: linha[6] ? parseFloat(linha[6]).toFixed(2) : "-",
        oddFora: linha[7] ? parseFloat(linha[7]).toFixed(2) : "-",
        probCasa: parseFloat(linha[8]) || 0,
        probEmpate: parseFloat(linha[9]) || 0,
        probFora: parseFloat(linha[10]) || 0,
        apostaSugerida: linha[11] || "-"
      };
    }).filter(Boolean);

    return {status: "success", data: jogos};
  } catch (e) {
    console.error("Erro:", e);
    return {status: "error", message: e.message};
  }
}

function formatarData(valor) {
  try {
    if (valor instanceof Date) {
      return Utilities.formatDate(valor, Session.getScriptTimeZone(), "dd/MM/yyyy");
    }
    return valor.toString();
  } catch (e) {
    return "-";
  }
}

function formatarHora(valor) {
  try {
    if (valor instanceof Date) {
      return Utilities.formatDate(valor, Session.getScriptTimeZone(), "HH:mm");
    }
    return valor.toString();
  } catch (e) {
    return "-";
  }
}

function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty('ODDS_API_KEY') || 'f1c1cdafcac8229605c6511686c9cbe9';
}

function fetchWithRetry(url, options, retries = 3) {
  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) return response;
    throw new Error(`HTTP ${response.getResponseCode()}`);
  } catch (error) {
    if (retries > 0) {
      Utilities.sleep(1000);
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

function testarConexao() {
  const resultado = obterJogos();
  Logger.log(resultado);
  return resultado;
}