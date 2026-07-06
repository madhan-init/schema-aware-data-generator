document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('generate-form');
    const ddlInput = document.getElementById('ddl-input');
    const rowsInput = document.getElementById('rows-input');
    const generateBtn = document.getElementById('generate-btn');
    // Search within generateBtn to avoid selecting visualizeBtn's elements
    const btnText = generateBtn.querySelector('.btn-text');
    const spinner = generateBtn.querySelector('.spinner');
    const errorMsg = document.getElementById('error-message');
    
    const tokenCounterElement = document.getElementById('token-counter');
    const tabsContainer = document.getElementById('tabs');
    const resultsContent = document.getElementById('results-content');
    const tokenCountValue = document.getElementById('token-count-value');

    // Initialize Mermaid if loaded
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'base',
            themeVariables: {
                background: '#ffffff',
                primaryColor: '#ffffff',
                primaryTextColor: '#111111',
                primaryBorderColor: '#111111',
                lineColor: '#111111',
                secondaryColor: '#f4efe6',
                tertiaryColor: '#ffffff',
                fontSize: '14px',
                fontFamily: 'Outfit, Inter, sans-serif'
            }
        });
    }

    // New NLP Elements
    const tabDdl = document.getElementById('tab-ddl');
    const tabNlp = document.getElementById('tab-nlp');
    const ddlSection = document.getElementById('ddl-section');
    const nlpSection = document.getElementById('nlp-section');
    const nlpInput = document.getElementById('nlp-input');
    const generateDdlBtn = document.getElementById('generate-ddl-btn');
    const nlpBtnText = document.getElementById('nlp-btn-text');
    const nlpSpinner = document.getElementById('nlp-spinner');

    // Tab Switching Logic
    tabDdl.addEventListener('click', () => {
        tabDdl.classList.add('active');
        tabNlp.classList.remove('active');
        ddlSection.style.display = 'block';
        nlpSection.style.display = 'none';
    });

    tabNlp.addEventListener('click', () => {
        tabNlp.classList.add('active');
        tabDdl.classList.remove('active');
        nlpSection.style.display = 'flex';
        nlpSection.style.flexDirection = 'column';
        ddlSection.style.display = 'none';
    });

    // Generate DDL from NLP Logic
    generateDdlBtn.addEventListener('click', async () => {
        const prompt = nlpInput.value.trim();
        if (!prompt) return;

        generateDdlBtn.disabled = true;
        nlpBtnText.classList.add('hidden');
        nlpSpinner.classList.remove('hidden');
        errorMsg.classList.add('hidden');

        try {
            const isLocalOrDifferentPort = window.location.protocol === 'file:' || window.location.port !== '8000';
            const baseUrl = isLocalOrDifferentPort ? 'http://localhost:8000' : '';
            const response = await fetch(`${baseUrl}/api/generate-ddl`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'An error occurred during DDL generation.');
            }

            // Populate DDL and switch tabs
            ddlInput.value = data.ddl;
            tabDdl.click();

            if (data.tokens_used) {
                globalTokenCount += data.tokens_used;
                if (tokenCountValue) tokenCountValue.textContent = globalTokenCount;
                if (globalTokenCount > 0 && tokenCounterElement) {
                    tokenCounterElement.classList.remove('hidden');
                }
            }
        } catch (error) {
            errorMsg.textContent = error.message;
            errorMsg.classList.remove('hidden');
        } finally {
            generateDdlBtn.disabled = false;
            nlpBtnText.classList.remove('hidden');
            nlpSpinner.classList.add('hidden');
        }
    });

    let currentData = null;
    let globalTokenCount = 0;
    // Clear any old saved tokens from localStorage just in case
    localStorage.removeItem('tokenCount');
    if (tokenCountValue) {
        tokenCountValue.textContent = globalTokenCount;
    }
    if (tokenCounterElement) {
        if (globalTokenCount === 0) {
            tokenCounterElement.classList.add('hidden');
        } else {
            tokenCounterElement.classList.remove('hidden');
        }
    }



    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const ddl = ddlInput.value.trim();
        const rows = parseInt(rowsInput.value);

        if (!ddl) return;

        // UI Loading state
        generateBtn.disabled = true;
        btnText.classList.add('hidden');
        spinner.classList.remove('hidden');
        errorMsg.classList.add('hidden');
        // We do not hide the persistent token counter during loading
        resultsContent.innerHTML = '<div class="empty-state"><p>Generating data (calling LLM)...</p></div>';

        try {
            const isLocalOrDifferentPort = window.location.protocol === 'file:' || window.location.port !== '8000';
            const baseUrl = isLocalOrDifferentPort ? 'http://localhost:8000' : '';
            const response = await fetch(`${baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ddl, rows })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'An error occurred during generation.');
            }

            currentData = data;
            
            // Accumulate tokens
            if (data.tokens_used) {
                globalTokenCount += data.tokens_used;
                if (tokenCountValue) tokenCountValue.textContent = globalTokenCount;
                if (globalTokenCount > 0 && tokenCounterElement) {
                    tokenCounterElement.classList.remove('hidden');
                }
            }
            renderTabs();
            if (tabsContainer.firstChild) {
                tabsContainer.firstChild.click(); // Default to first table
            }

        } catch (error) {
            errorMsg.textContent = error.message;
            errorMsg.classList.remove('hidden');
            resultsContent.innerHTML = '<div class="empty-state"><p>Error generating data.</p></div>';
        } finally {
            generateBtn.disabled = false;
            btnText.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    });

    function convertSchemaToMermaid(schema) {
        let mermaidText = "erDiagram\n";
        const entries = Object.entries(schema);
        if (entries.length === 0) {
            return "";
        }
        
        for (const [tableName, tableData] of entries) {
            mermaidText += `    ${tableName} {\n`;
            if (tableData.columns && tableData.columns.length > 0) {
                tableData.columns.forEach(col => {
                    let cleanType = col.type.replace(/\(.*\)/, '').replace(/[^a-zA-Z0-9_]/g, '_').trim();
                    if (!cleanType) cleanType = "VARCHAR";
                    
                    let key = "";
                    if (col.primary_key) {
                        key = "PK";
                    }
                    const isFk = tableData.foreign_keys && tableData.foreign_keys.some(fk => fk.column === col.name);
                    if (isFk) {
                        key = key ? "PK_FK" : "FK";
                    }
                    
                    mermaidText += `        ${cleanType} ${col.name} ${key}\n`;
                });
            } else {
                mermaidText += "        INT id PK\n";
            }
            mermaidText += `    }\n`;
        }
        
        for (const [tableName, tableData] of entries) {
            if (tableData.foreign_keys && tableData.foreign_keys.length > 0) {
                tableData.foreign_keys.forEach(fk => {
                    mermaidText += `    ${tableName} }o--|| ${fk.ref_table} : "${fk.column}"\n`;
                });
            }
        }
        return mermaidText;
    }

    async function renderERD(schema) {
        const mText = convertSchemaToMermaid(schema);
        if (!mText) {
            resultsContent.innerHTML = '<div class="empty-state"><p>No tables or relations to display in ERD.</p></div>';
            return;
        }
        
        resultsContent.innerHTML = `<div class="erd-viewer" id="erd-viewer-container"></div>`;
        const container = document.getElementById('erd-viewer-container');
        
        try {
            container.innerHTML = '<div class="empty-state"><p>Rendering ERD Diagram...</p></div>';
            if (typeof mermaid === 'undefined') {
                throw new Error("Mermaid.js library is not loaded.");
            }
            const uniqueId = `mermaid-svg-${Date.now()}`;
            const { svg } = await mermaid.render(uniqueId, mText);
            container.innerHTML = svg;
        } catch (err) {
            console.error("Mermaid error:", err);
            container.innerHTML = `
                <div style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; align-items: center; justify-content: center; height: 100%; text-align: center;">
                    <div style="font-weight: 700; color: var(--accent-red);">Failed to render ERD Diagram</div>
                    <p style="font-size: 0.85rem; font-family: monospace; color: var(--text-secondary); max-width: 500px; word-break: break-all; margin: 0.5rem 0;">
                        ${escapeHtml(err.message || String(err))}
                    </p>
                    <button id="view-raw-mermaid-btn" class="tab" style="box-shadow: 2px 2px 0px #111; font-size: 0.8rem; height: auto; padding: 0.5rem 1rem;">View Raw Diagram Text</button>
                </div>
            `;
            const rawBtn = document.getElementById('view-raw-mermaid-btn');
            if (rawBtn) {
                rawBtn.onclick = () => {
                    container.innerHTML = `<div class="code-viewer" style="padding: 1.5rem; white-space: pre-wrap;">${escapeHtml(mText)}</div>`;
                };
            }
        }
    }

    function renderTabs() {
        tabsContainer.innerHTML = '';

        // Schema ERD tab first
        const erdTab = document.createElement('button');
        erdTab.className = 'tab';
        erdTab.textContent = 'Schema ERD';
        erdTab.onclick = () => {
            setActiveTab(erdTab);
            renderERD(currentData.schema);
        };
        tabsContainer.appendChild(erdTab);

        // Table tabs
        currentData.tables.forEach((table, index) => {
            const tab = document.createElement('button');
            tab.className = 'tab';
            tab.textContent = table.name;
            tab.onclick = () => {
                setActiveTab(tab);
                renderTableViewer(index);
            };
            tabsContainer.appendChild(tab);
        });

        // Seed All tab last
        const seedTab = document.createElement('button');
        seedTab.className = 'tab';
        seedTab.textContent = 'seed_all.sql';
        seedTab.onclick = () => {
            setActiveTab(seedTab);
            renderSeedAll();
        };
        tabsContainer.appendChild(seedTab);
    }

    function setActiveTab(selectedTab) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        selectedTab.classList.add('active');
    }

    function renderSeedAll() {
        resultsContent.innerHTML = `<div class="code-viewer">${escapeHtml(currentData.seed_all)}</div>`;
    }

    // Visualize DDL Button Logic
    const visualizeBtn = document.getElementById('visualize-btn');
    if (visualizeBtn) {
        visualizeBtn.addEventListener('click', async () => {
            const ddl = ddlInput.value.trim();
            if (!ddl) return;
            
            visualizeBtn.disabled = true;
            const btnTextSpan = visualizeBtn.querySelector('.btn-text');
            const spinnerSpan = visualizeBtn.querySelector('.spinner');
            
            btnTextSpan.classList.add('hidden');
            spinnerSpan.classList.remove('hidden');
            errorMsg.classList.add('hidden');
            resultsContent.innerHTML = '<div class="empty-state"><p>Parsing DDL schema...</p></div>';
            
            try {
                const isLocalOrDifferentPort = window.location.protocol === 'file:' || window.location.port !== '8000';
                const baseUrl = isLocalOrDifferentPort ? 'http://localhost:8000' : '';
                const response = await fetch(`${baseUrl}/api/parse`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ddl })
                });
                
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.detail || 'An error occurred during DDL parsing.');
                }
                
                // Render single visualizer tab
                tabsContainer.innerHTML = '';
                const erdTab = document.createElement('button');
                erdTab.className = 'tab active';
                erdTab.textContent = 'Schema ERD';
                tabsContainer.appendChild(erdTab);
                
                erdTab.onclick = () => {
                    setActiveTab(erdTab);
                    renderERD(data.schema);
                };
                
                await renderERD(data.schema);
                
            } catch (error) {
                errorMsg.textContent = error.message;
                errorMsg.classList.remove('hidden');
                resultsContent.innerHTML = '<div class="empty-state"><p>Error parsing schema.</p></div>';
            } finally {
                visualizeBtn.disabled = false;
                btnTextSpan.classList.remove('hidden');
                spinnerSpan.classList.add('hidden');
            }
        });
    }

    function renderTableViewer(tableIndex) {
        const table = currentData.tables[tableIndex];

        resultsContent.innerHTML = `
            <div style="height: 100%; display: flex; flex-direction: column;">
                <div class="format-tabs" style="display: flex; justify-content: space-between; align-items: center; padding-right: 1rem;">
                    <div style="display: flex;">
                        <div class="format-tab active" id="view-table">Table Data</div>
                        <div class="format-tab" id="view-sql">SQL Insert</div>
                        <div class="format-tab" id="view-csv">CSV Data</div>
                    </div>
                    <button id="download-csv-btn" style="height: 32px; padding: 0 1rem; font-size: 0.85rem; background: var(--accent-red); color: white; box-shadow: 2px 2px 0px 0px #111111; transition: none;">Download CSV</button>
                </div>
                <div class="code-viewer" id="code-content" style="padding: 0;"></div>
            </div>
        `;

        function buildTableHtml(dataRows) {
            if (!dataRows || dataRows.length === 0) return '<div class="empty-state">No data</div>';
            const headers = Object.keys(dataRows[0]);
            let html = '<div class="data-table-container"><table class="data-table"><thead><tr>';
            headers.forEach(h => html += `<th>${escapeHtml(h)}</th>`);
            html += '</tr></thead><tbody>';
            dataRows.forEach(row => {
                html += '<tr>';
                headers.forEach(h => html += `<td>${escapeHtml(String(row[h] !== null ? row[h] : ''))}</td>`);
                html += '</tr>';
            });
            html += '</tbody></table></div>';
            return html;
        }

        const codeContent = document.getElementById('code-content');

        document.getElementById('download-csv-btn').onclick = () => {
            const blob = new Blob([table.csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${table.name}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        document.getElementById('view-table').onclick = (e) => {
            document.querySelectorAll('.format-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            codeContent.style.padding = '0';
            codeContent.innerHTML = buildTableHtml(table.data);
        };

        document.getElementById('view-sql').onclick = (e) => {
            document.querySelectorAll('.format-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            codeContent.style.padding = '1.5rem';
            codeContent.innerHTML = escapeHtml(table.sql);
        };

        document.getElementById('view-csv').onclick = (e) => {
            document.querySelectorAll('.format-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            codeContent.style.padding = '1.5rem';
            codeContent.innerHTML = escapeHtml(table.csv);
        };

        // Default
        document.getElementById('view-table').click();
    }

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});
