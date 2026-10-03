require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// Conexão com o Banco PostgreSQL usando obrigatoriamente a variável de ambiente
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('Erro ao conectar ao Banco Neon:', err.stack);
    }
    console.log('Conectado com sucesso ao Banco Neon!');
    release();
});

async function inicializarBanco() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ingredientes (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                unidade TEXT NOT NULL,
                quantidade_embalagem NUMERIC NOT NULL,
                preco_embalagem NUMERIC NOT NULL,
                estoque_atual NUMERIC DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS receitas (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                rendimento NUMERIC NOT NULL,
                unidade_rendimento TEXT DEFAULT 'g',
                itens JSONB DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS orcamentos (
                id SERIAL PRIMARY KEY,
                cliente TEXT,
                descricao TEXT,
                valor NUMERIC,
                horas NUMERIC DEFAULT 0,
                valor_hora NUMERIC DEFAULT 25,
                custos_operacionais NUMERIC DEFAULT 0,
                margem_lucro NUMERIC DEFAULT 0,
                embalagem NUMERIC DEFAULT 0,
                taxa_entrega NUMERIC DEFAULT 0,
                itens_json JSONB DEFAULT '[]',
                status TEXT DEFAULT 'aberto',
                data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='receitas' and column_name='itens') THEN
                    ALTER TABLE receitas ADD COLUMN itens JSONB DEFAULT '[]';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='receitas' and column_name='unidade_rendimento') THEN
                    ALTER TABLE receitas ADD COLUMN unidade_rendimento TEXT DEFAULT 'g';
                END IF;
            END $$;
        `);

        console.log('Tabelas e colunas verificadas/atualizadas com sucesso no Banco Neon.');
    } catch (e) {
        console.error('Erro ao inicializar tabelas:', e);
    }
}
inicializarBanco();

// ================= ROTAS DE INGREDIENTES =================
app.get('/api/ingredientes', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ingredientes ORDER BY nome ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ingredientes', async (req, res) => {
    const { nome, unidade, quantidade_embalagem, preco_embalagem, estoque_atual } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO ingredientes (nome, unidade, quantidade_embalagem, preco_embalagem, estoque_atual) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [nome, unidade, quantidade_embalagem, preco_embalagem, estoque_atual || quantidade_embalagem]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/ingredientes/:id/estoque', async (req, res) => {
    const { id } = req.params;
    const { quantidade, preco_embalagem } = req.body;
    try {
        let query, params;
        if (preco_embalagem !== undefined) {
            query = 'UPDATE ingredientes SET estoque_atual = estoque_atual + $1, preco_embalagem = $3 WHERE id = $2 RETURNING *';
            params = [quantidade, id, preco_embalagem];
        } else {
            query = 'UPDATE ingredientes SET estoque_atual = estoque_atual + $1 WHERE id = $2 RETURNING *';
            params = [quantidade, id];
        }
        const result = await pool.query(query, params);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/ingredientes/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM ingredientes WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= ROTAS DE RECEITAS =================
app.get('/api/receitas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM receitas ORDER BY nome ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/receitas', async (req, res) => {
    const { nome, rendimento, unidade_rendimento, itens } = req.body;
    try {
        const itensTratados = Array.isArray(itens) ? itens.map(i => ({
            ingrediente_id: i.ingrediente_id ? parseInt(i.ingrediente_id) : null,
            nome: i.nome || 'Ingrediente',
            quantidade: parseFloat(i.quantidade) || 0,
            unidade: i.unidade || 'g'
        })) : [];

        const result = await pool.query(
            'INSERT INTO receitas (nome, rendimento, unidade_rendimento, itens) VALUES ($1, $2, $3, $4) RETURNING *',
            [nome, parseFloat(rendimento) || 1, unidade_rendimento || 'g', JSON.stringify(itensTratados)]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Erro ao salvar receita:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/receitas/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, rendimento, unidade_rendimento, itens } = req.body;
    try {
        const itensTratados = Array.isArray(itens) ? itens.map(i => ({
            ingrediente_id: i.ingrediente_id ? parseInt(i.ingrediente_id) : null,
            nome: i.nome || 'Ingrediente',
            quantidade: parseFloat(i.quantidade) || 0,
            unidade: i.unidade || 'g'
        })) : [];

        const result = await pool.query(
            'UPDATE receitas SET nome = $1, rendimento = $2, unidade_rendimento = $3, itens = $4 WHERE id = $5 RETURNING *',
            [nome, parseFloat(rendimento) || 1, unidade_rendimento || 'g', JSON.stringify(itensTratados), id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Erro ao atualizar receita:', err);
        res.status(500).json({ error: err.message });
    }
});


// ================= ROTA DE INTELIGÊNCIA ARTIFICIAL PARA RECEITAS (VIA FETCH) =================
app.post('/api/ia/interpretar-receita', async (req, res) => {
    const { texto, imagemBase64, mimeType } = req.body;
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("A chave GEMINI_API_KEY não está definida nas variáveis de ambiente.");
        }

        const prompt = `Analise o texto ou imagem da receita fornecida e extraia os dados estritamente em formato JSON válido, sem blocos de markdown adicionais.
        
        IMPORTANTE SOBRE CONVERSÃO DE MEDIDAS CASEIRAS PARA PESO/VOLUME (PADRÃO CONFEITARIA):
- 1 xícara de farinha de trigo = 120g a 130g
- 1 xícara de açúcar = 180g a 200g
- 1 xícara de fubá = 150g
- 1 xícara de leite ou óleo = 240 ml
- 1 copo americano = 150 ml ou g
- 1 colher de sopa = 15g ou 15 ml
- 1 colher de chá = 5g ou 5 ml
        Sempre converta xícaras, copos e colheres para o valor total correspondente em gramas (g) ou mililitros (ml) nos campos "quantidade" e defina a unidade como "g" ou "ml" (exceto para ovos ou unidades inteiras).

        Retorne exatamente esta estrutura JSON:
        {
          "nome": "Nome da receita",
          "rendimento": número em gramas ou ml,
          "unidade_rendimento": "g" ou "ml" ou "unidade",
          "itens": [
            {
              "nome": "Nome limpo do ingrediente",
              "quantidade": número convertido em gramas/ml/unidades,
              "unidade": "g" ou "ml" ou "unidade"
            }
          ]
        }`;

        let parts = [{ text: prompt }];

        if (imagemBase64) {
            parts.push({
                inlineData: {
                    data: imagemBase64,
                    mimeType: mimeType || 'image/jpeg'
                }
            });
        }

        if (texto) {
            parts.push({ text: `Texto da receita:\n${texto}` });
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{ parts: parts }],
                generationConfig: {
                    responseMimeType: 'application/json'
                }
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error?.message || 'Erro na API do Gemini');
        }

        const textoBruto = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        const textoResposta = textoBruto.replace(/```json/g, '').replace(/```/g, '').trim();
        const resultadoJson = JSON.parse(textoResposta);
        res.json(resultadoJson);
    } catch (err) {
        console.error('Erro na IA:', err);
        res.status(500).json({ error: 'Erro ao interpretar receita com IA: ' + err.message });
    }
});

// ================= ROTAS DE ORÇAMENTOS & FINANCEIRO =================
app.get('/api/orcamentos', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM orcamentos WHERE status = 'aberto' ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/orcamentos', async (req, res) => {
    const { cliente, descricao, valor, horas, valor_hora, custos_operacionais, margem_lucro, embalagem, taxa_entrega, itens } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO orcamentos (cliente, descricao, valor, horas, valor_hora, custos_operacionais, margem_lucro, embalagem, taxa_entrega, itens_json, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
            [cliente, descricao, valor, horas, valor_hora, custos_operacionais, margem_lucro, embalagem, taxa_entrega, JSON.stringify(itens), 'aberto']
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/orcamentos/:id', async (req, res) => {
    const { id } = req.params;
    const { cliente, descricao, valor, horas, valor_hora, custos_operacionais, margem_lucro, embalagem, taxa_entrega, itens } = req.body;
    try {
        const result = await pool.query(
            'UPDATE orcamentos SET cliente = $1, descricao = $2, valor = $3, horas = $4, valor_hora = $5, custos_operacionais = $6, margem_lucro = $7, embalagem = $8, taxa_entrega = $9, itens_json = $10 WHERE id = $11 RETURNING *',
            [cliente, descricao, valor, horas, valor_hora, custos_operacionais, margem_lucro, embalagem, taxa_entrega, JSON.stringify(itens), id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/orcamentos/:id/concluir', async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orcRes = await client.query('SELECT * FROM orcamentos WHERE id = $1', [id]);
        if (orcRes.rows.length === 0) throw new Error('Orçamento não encontrado');
        const orc = orcRes.rows[0];
        let itensPedido = orc.itens_json;
        if (typeof itensPedido === 'string') itensPedido = JSON.parse(itensPedido);

        const recRes = await client.query('SELECT * FROM receitas');
        const receitasMap = recRes.rows;

        const consumoTotal = {};
        for (let item of itensPedido) {
            const multi = parseFloat(item.quantidade) || 1;
            if (item.tipo === 'avulso') {
                consumoTotal[item.ingrediente_id] = (consumoTotal[item.ingrediente_id] || 0) + multi;
            } else if (item.tipo === 'receita') {
                const rec = receitasMap.find(r => r.id === item.receita_id);
                if (rec && rec.itens) {
                    let recItens = rec.itens;
                    if (typeof recItens === 'string') recItens = JSON.parse(recItens);
                    for (let ri of recItens) {
                        const qtdNec = (parseFloat(ri.quantidade) || 0) * multi;
                        consumoTotal[ri.ingrediente_id] = (consumoTotal[ri.ingrediente_id] || 0) + qtdNec;
                    }
                }
            }
        }

        for (let ingId in consumoTotal) {
            const ingRes = await client.query('SELECT * FROM ingredientes WHERE id = $1', [ingId]);
            if (ingRes.rows.length > 0) {
                const estoqueAtual = parseFloat(ingRes.rows[0].estoque_atual) || 0;
                const necess = consumoTotal[ingId];
                if (estoqueAtual < necess) {
                    throw new Error(`Estoque insuficiente para o ingrediente ${ingRes.rows[0].nome}. Necessário: ${necess}, Disponível: ${estoqueAtual}`);
                }
            }
        }

        for (let ingId in consumoTotal) {
            await client.query('UPDATE ingredientes SET estoque_atual = estoque_atual - $1 WHERE id = $2', [consumoTotal[ingId], ingId]);
        }

        await client.query("UPDATE orcamentos SET status = 'concluido' WHERE id = $1", [id]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.delete('/api/orcamentos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM orcamentos WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/orcamentos/concluidos', async (req, res) => {
    const { mes } = req.query;
    try {
        let query = "SELECT * FROM orcamentos WHERE status = 'concluido'";
        let params = [];
        if (mes) {
            query += " AND to_char(data_criacao, 'YYYY-MM') = $1";
            params.push(mes);
        }
        query += " ORDER BY id DESC";
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});