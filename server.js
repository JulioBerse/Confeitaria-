require('dotenv').config();
const express = require('express');
const path = require('path');
const { pool } = require('./pool');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal para servir o index.html da raiz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota de Ingredientes (Listar)
app.get('/api/ingredientes', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nome, unidade, quantidade_embalagem, preco_embalagem, estoque_atual FROM ingredientes ORDER BY nome ASC');
    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar ingredientes:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Rota de Ingredientes (Cadastrar)
app.post('/api/ingredientes', async (req, res) => {
  const { nome, unidade, quantidade_embalagem, preco_embalagem, estoque_atual } = req.body;
  try {
    const query = `
      INSERT INTO ingredientes (nome, unidade, quantidade_embalagem, preco_embalagem, estoque_atual) 
      VALUES ($1, $2, $3, $4, $5) RETURNING *;
    `;
    const values = [nome, unidade, quantidade_embalagem, preco_embalagem, estoque_atual || quantidade_embalagem];
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Erro ao cadastrar ingrediente:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- ROTA DELETE PARA INGREDIENTES ---
app.delete('/api/ingredientes/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM ingredientes WHERE id = $1', [id]);
        res.status(200).json({ message: 'Ingrediente excluído com sucesso!' });
    } catch (err) {
        console.error('Erro ao excluir ingrediente:', err);
        res.status(500).json({ error: err.message });
    }
});

// Rota de Estoque e Atualização de Ingrediente (Soma ao estoque atual e atualiza o preço, mantendo o tamanho base da embalagem)
app.patch('/api/ingredientes/:id/estoque', async (req, res) => {
  const { id } = req.params;
  const { quantidade, preco_embalagem } = req.body;
  try {
    let query, values;
    
    if (preco_embalagem !== undefined) {
      query = `
        UPDATE ingredientes 
        SET estoque_atual = GREATEST(0, estoque_atual + $1),
            preco_embalagem = $2
        WHERE id = $3 RETURNING *;
      `;
      values = [quantidade, preco_embalagem, id];
    } else {
      query = `
        UPDATE ingredientes 
        SET estoque_atual = GREATEST(0, estoque_atual + $1) 
        WHERE id = $2 RETURNING *;
      `;
      values = [quantidade, id];
    }

    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro ao atualizar estoque/ingrediente:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Rota de Receitas (Listar)
app.get('/api/receitas', async (req, res) => {
  try {
    const receitasQuery = await pool.query('SELECT * FROM receitas ORDER BY nome ASC');
    const receitas = receitasQuery.rows;

    for (let receita of receitas) {
      const itensQuery = await pool.query(`
        SELECT ri.*, i.nome, i.unidade, i.quantidade_embalagem, i.preco_embalagem 
        FROM receita_itens ri
        JOIN ingredientes i ON ri.ingrediente_id = i.id
        WHERE ri.receita_id = $1
      `, [receita.id]);
      receita.itens = itensQuery.rows;
    }

    res.json(receitas);
  } catch (err) {
    console.error("Erro ao buscar receitas:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Rota de Receitas (Cadastrar)
app.post('/api/receitas', async (req, res) => {
  const { nome, rendimento, unidade_rendimento, itens } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const receitaQuery = `
      INSERT INTO receitas (nome, rendimento, unidade_rendimento) 
      VALUES ($1, $2, $3) RETURNING id;
    `;
    const receitaResult = await client.query(receitaQuery, [nome, rendimento, unidade_rendimento]);
    const receitaId = receitaResult.rows[0].id;

    for (let item of itens) {
      const itemQuery = `
        INSERT INTO receita_itens (receita_id, ingrediente_id, quantidade) 
        VALUES ($1, $2, $3);
      `;
      await client.query(itemQuery, [receitaId, item.ingrediente_id, item.quantidade]);
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Receita cadastrada com sucesso!' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Erro ao cadastrar receita:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Rota de Receitas (Atualizar / Editar)
app.put('/api/receitas/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, rendimento, unidade_rendimento, itens } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const receitaQuery = `
      UPDATE receitas 
      SET nome = $1, rendimento = $2, unidade_rendimento = $3 
      WHERE id = $4;
    `;
    await client.query(receitaQuery, [nome, rendimento, unidade_rendimento, id]);

    await client.query('DELETE FROM receita_itens WHERE receita_id = $1', [id]);

    for (let item of itens) {
      const itemQuery = `
        INSERT INTO receita_itens (receita_id, ingrediente_id, quantidade) 
        VALUES ($1, $2, $3);
      `;
      await client.query(itemQuery, [id, item.ingrediente_id, item.quantidade]);
    }

    await client.query('COMMIT');
    res.status(200).json({ message: 'Receita atualizada com sucesso!' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Erro ao atualizar receita:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Rota para salvar um novo orçamento (Com suporte a itens_json)
app.post('/api/orcamentos', async (req, res) => {
    try {
        const { cliente, descricao, valor, horas, valor_hora, custos_operacionais, margem_lucro, embalagem, taxa_entrega, itens } = req.body;
        const novo = await pool.query(
            'INSERT INTO orcamentos (cliente, descricao, valor, horas, valor_hora, custos_operacionais, margem_lucro, embalagem, taxa_entrega, status, itens_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
            [cliente, descricao, valor, horas || 0, valor_hora || 25.00, custos_operacionais || 0, margem_lucro || 0, embalagem || 0.00, taxa_entrega || 0.00, 'aberto', JSON.stringify(itens || [])]
        );
        res.json(novo.rows[0]);
    } catch (err) {
        console.error('Erro ao salvar orçamento:', err);
        res.status(500).send('Erro ao salvar orçamento');
    }
});

// Rota para atualizar um orçamento existente (EDITAR)
app.put('/api/orcamentos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { cliente, descricao, valor, horas, valor_hora, custos_operacionais, margem_lucro, embalagem, taxa_entrega, itens } = req.body;
        const atualizado = await pool.query(
            'UPDATE orcamentos SET cliente = $1, descricao = $2, valor = $3, horas = $4, valor_hora = $5, custos_operacionais = $6, margem_lucro = $7, embalagem = $8, taxa_entrega = $9, itens_json = $10 WHERE id = $11 RETURNING *',
            [cliente, descricao, valor, horas || 0, valor_hora || 25.00, custos_operacionais || 0, margem_lucro || 0, embalagem || 0.00, taxa_entrega || 0.00, JSON.stringify(itens || []), id]
        );
        res.json(atualizado.rows[0]);
    } catch (err) {
        console.error('Erro ao atualizar orçamento:', err);
        res.status(500).send('Erro ao atualizar orçamento');
    }
});

// Rota para listar apenas os orçamentos em aberto
app.get('/api/orcamentos', async (req, res) => {
    try {
        const lista = await pool.query("SELECT * FROM orcamentos WHERE status = 'aberto' ORDER BY id DESC");
        res.json(lista.rows);
    } catch (err) {
        res.status(500).send('Erro ao buscar orçamentos');
    }
});

// Rota para buscar orçamentos concluídos (com suporte a filtro mensal opcional)
app.get('/api/orcamentos/concluidos', async (req, res) => {
    const { mes } = req.query; 
    try {
        let query = "SELECT * FROM orcamentos WHERE status = 'concluido'";
        let params = [];

        if (mes) {
            query += " AND TO_CHAR(criado_em, 'YYYY-MM') = $1";
            params.push(mes);
        }

        query += " ORDER BY criado_em DESC";
        
        const resultado = await pool.query(query, params);
        res.status(200).json(resultado.rows);
    } catch (err) {
        console.error('Erro ao buscar orçamentos concluídos:', err);
        res.status(500).json({ error: err.message });
    }
});

// Rota para concluir um orçamento E DAR BAIXA AUTOMÁTICA NO ESTOQUE
app.patch('/api/orcamentos/:id/concluir', async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Busca os detalhes do orçamento
        const orcRes = await client.query("SELECT * FROM orcamentos WHERE id = $1", [id]);
        if (orcRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Orçamento não encontrado.' });
        }
        const orc = orcRes.rows[0];

        // 2. Atualiza o status para concluído
        await client.query("UPDATE orcamentos SET status = 'concluido' WHERE id = $1", [id]);

        // 3. Processa a baixa automática no estoque
        if (orc.itens_json) {
            let itensPedido = [];
            try {
                itensPedido = typeof orc.itens_json === 'string' ? JSON.parse(orc.itens_json) : orc.itens_json;
            } catch (e) {
                console.error("Erro ao parsear itens_json:", e);
            }

            if (Array.isArray(itensPedido)) {
                for (let item of itensPedido) {
                    const ingredienteAvulsoId = item.ingrediente_id || item.ingredienteId;
                    const qtdItem = parseFloat(item.quantidade) || 0;

                    if (item.tipo === 'avulso' && ingredienteAvulsoId) {
                        await client.query(
                            "UPDATE ingredientes SET estoque_atual = GREATEST(0, estoque_atual - $1) WHERE id = $2",
                            [qtdItem, ingredienteAvulsoId]
                        );
                    } 
                    
                    const receitaId = item.receita_id || item.receitaId;
                    if (receitaId) {
                        const recItensRes = await client.query(
                            "SELECT ingrediente_id, quantidade FROM receita_itens WHERE receita_id = $1",
                            [receitaId]
                        );

                        for (let recItem of recItensRes.rows) {
                            const qtdConsumida = (parseFloat(recItem.quantidade) || 0) * qtdItem;
                            await client.query(
                                "UPDATE ingredientes SET estoque_atual = GREATEST(0, estoque_atual - $1) WHERE id = $2",
                                [qtdConsumida, recItem.ingrediente_id]
                            );
                        }
                    }
                }
            }
        }

        await client.query('COMMIT');
        res.json({ mensagem: 'Orçamento concluído e estoque atualizado com sucesso!' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro ao concluir orçamento e baixar estoque:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Rota para apagar orçamento
app.delete('/api/orcamentos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM orcamentos WHERE id = $1', [id]);
        res.json({ mensagem: 'Orçamento removido com sucesso!' });
    } catch (err) {
        res.status(500).send('Erro ao remover orçamento');
    }
});

// Inicialização do servidor
app.listen(port, () => {
  console.log(`Servidor a correr na porta ${port}`);
});