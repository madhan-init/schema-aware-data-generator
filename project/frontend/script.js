document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('generate-form');
    const ddlInput = document.getElementById('ddl-input');
    const rowsInput = document.getElementById('rows-input');
    const analyzeBtn = document.getElementById('analyze-btn');
    // Search within analyzeBtn to avoid selecting visualizeBtn's elements
    const btnText = analyzeBtn.querySelector('.btn-text');
    const spinner = analyzeBtn.querySelector('.spinner');
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



    analyzeBtn.addEventListener('click', async () => {
        const ddl = ddlInput.value.trim();
        if (!ddl) return;

        // UI Loading state
        analyzeBtn.disabled = true;
        btnText.classList.add('hidden');
        spinner.classList.remove('hidden');
        errorMsg.classList.add('hidden');
        resultsContent.innerHTML = '<div class="empty-state"><p>Analyzing DDL and mapping columns (calling LLM)...</p></div>';

        try {
            const isLocalOrDifferentPort = window.location.protocol === 'file:' || window.location.port !== '8000';
            const baseUrl = isLocalOrDifferentPort ? 'http://localhost:8000' : '';
            const response = await fetch(`${baseUrl}/api/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ddl })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'An error occurred during analysis.');
            }

            // Accumulate tokens
            if (data.tokens_used) {
                globalTokenCount += data.tokens_used;
                if (tokenCountValue) tokenCountValue.textContent = globalTokenCount;
                if (globalTokenCount > 0 && tokenCounterElement) {
                    tokenCounterElement.classList.remove('hidden');
                }
            }

            // Render Customization Dashboard
            renderCustomizationDashboard(data.schema, data.column_map);

        } catch (error) {
            errorMsg.textContent = error.message;
            errorMsg.classList.remove('hidden');
            resultsContent.innerHTML = '<div class="empty-state"><p>Error analyzing schema.</p></div>';
        } finally {
            analyzeBtn.disabled = false;
            btnText.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    });

    function renderCustomizationDashboard(schema, columnMap) {
        tabsContainer.innerHTML = ''; // Hide table tabs
        
        let html = `
            <div class="config-container">
                <div class="config-header">
                    <h2>Configure Data Generation</h2>
                    <button id="cancel-config-btn" class="tab" style="box-shadow: 2px 2px 0px #111; font-size: 0.8rem; height: auto; padding: 0.5rem 1rem;">Back to DDL</button>
                </div>
                <div class="config-body">
        `;

        const defaultRows = parseInt(rowsInput.value) || 10;

        for (const [tableName, tableData] of Object.entries(schema)) {
            html += `
                <div class="table-card" data-table="${tableName}">
                    <div class="table-card-header">
                        <div class="table-card-title">${escapeHtml(tableName)}</div>
                        <div class="table-card-rows">
                            <label>Rows:</label>
                            <input type="number" class="table-rows-input" value="${defaultRows}" min="0" max="1000">
                        </div>
                    </div>
                    
                    <div class="col-headers">
                        <div>Column</div>
                        <div>Badge</div>
                        <div>Gen Type</div>
                        <div>Expression / Values</div>
                        <div>Null %</div>
                    </div>
                    <div class="columns-config-list">
            `;

            tableData.columns.forEach(col => {
                const colName = col.name;
                const colType = col.type;
                const isPk = col.primary_key;
                const isNullable = col.nullable;
                const isUnique = col.unique;

                // Check foreign key status
                const isFk = tableData.foreign_keys && tableData.foreign_keys.some(fk => fk.column === colName);
                const fkDef = isFk ? tableData.foreign_keys.find(fk => fk.column === colName) : null;
                
                // Determine badge type
                let badgeClass = 'none';
                let badgeText = 'col';
                if (isPk) {
                    badgeClass = 'pk';
                    badgeText = 'pk';
                } else if (isFk) {
                    badgeClass = 'fk';
                    badgeText = 'fk';
                }

                // Initial Faker expression
                let initialFakerExpr = '';
                if (isFk) {
                    initialFakerExpr = `FK:${fkDef.ref_table}.${fkDef.ref_column}`;
                } else {
                    initialFakerExpr = columnMap[tableName]?.[colName] || '';
                }

                // Options for Generator Type
                let generatorOptions = '';
                if (isFk) {
                    generatorOptions = `<option value="fk" selected>Foreign Key</option>`;
                } else {
                    generatorOptions = `
                        <option value="faker" selected>Faker Expression</option>
                        <option value="list">Custom List</option>
                    `;
                }

                // Null probability inputs
                const nullDisabled = (isPk || isFk || !isNullable) ? 'disabled' : '';
                const initialNullPct = (isPk || isFk || !isNullable) ? 0 : 10; // default 10% null for nullable fields

                html += `
                    <div class="col-config-row" data-column="${colName}">
                        <div class="col-name-container">
                            <span class="col-name-text">${escapeHtml(colName)}</span>
                            <span class="col-type-text">${escapeHtml(colType)}</span>
                        </div>
                        <div>
                            <span class="key-badge ${badgeClass}">${badgeText}</span>
                        </div>
                        <div>
                            <select class="col-generator-select" ${isFk ? 'disabled' : ''}>
                                ${generatorOptions}
                            </select>
                        </div>
                        <div class="col-detail-container">
                            <input type="text" class="col-detail-input" value="${escapeHtml(initialFakerExpr)}" placeholder="${isFk ? '' : 'faker.name()'}">
                        </div>
                        <div class="col-nullability-container">
                            <input type="range" class="col-null-slider" min="0" max="100" value="${initialNullPct}" ${nullDisabled}>
                            <span class="col-null-label">${initialNullPct}%</span>
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        html += `
                </div>
                <div class="config-footer">
                    <button type="button" id="submit-gen-btn">
                        <span class="btn-text">Generate Mock Data</span>
                        <span class="spinner hidden"></span>
                    </button>
                </div>
            </div>
        `;

        resultsContent.innerHTML = html;

        // Add event listeners to the Customization Dashboard
        document.getElementById('cancel-config-btn').addEventListener('click', () => {
            resultsContent.innerHTML = '<div class="empty-state"><p>Configuration cancelled. Paste your schema and click Analyze & Map.</p></div>';
            tabsContainer.innerHTML = '';
        });

        // Sliders change event listeners
        resultsContent.querySelectorAll('.col-null-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const label = e.target.nextElementSibling;
                label.textContent = `${e.target.value}%`;
            });
        });

        // Generator select type change event listener
        resultsContent.querySelectorAll('.col-generator-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const row = e.target.closest('.col-config-row');
                const input = row.querySelector('.col-detail-input');
                if (e.target.value === 'list') {
                    input.placeholder = 'e.g. active, inactive, pending';
                    if (!input.value.includes(',')) {
                        input.value = '';
                    }
                } else {
                    input.placeholder = 'faker.name()';
                    const colName = row.dataset.column;
                    const tableName = row.closest('.table-card').dataset.table;
                    input.value = columnMap[tableName]?.[colName] || '';
                }
            });
        });

        // Submit generation logic
        document.getElementById('submit-gen-btn').addEventListener('click', async () => {
            const submitBtn = document.getElementById('submit-gen-btn');
            const submitText = submitBtn.querySelector('.btn-text');
            const submitSpinner = submitBtn.querySelector('.spinner');

            submitBtn.disabled = true;
            submitText.classList.add('hidden');
            submitSpinner.classList.remove('hidden');
            errorMsg.classList.add('hidden');

            try {
                // Construct the tables_config object
                const tablesConfig = {};
                
                resultsContent.querySelectorAll('.table-card').forEach(card => {
                    const tableName = card.dataset.table;
                    const rowsInputVal = card.querySelector('.table-rows-input');
                    const rowsCount = parseInt(rowsInputVal.value) || 0;
                    
                    const columnsCfg = {};
                    
                    card.querySelectorAll('.col-config-row').forEach(row => {
                        const colName = row.dataset.column;
                        const genSelect = row.querySelector('.col-generator-select');
                        const detailInput = row.querySelector('.col-detail-input');
                        const nullSlider = row.querySelector('.col-null-slider');
                        
                        const genType = genSelect ? genSelect.value : 'fk';
                        const details = detailInput.value.trim();
                        const nullPct = parseInt(nullSlider.value) || 0;
                        
                        const colCfg = {
                            faker_expr: "",
                            null_percentage: nullPct,
                            custom_list: []
                        };
                        
                        if (genType === 'fk') {
                            colCfg.faker_expr = details;
                        } else if (genType === 'list') {
                            colCfg.custom_list = details.split(',').map(s => s.trim()).filter(s => s.length > 0);
                        } else {
                            colCfg.faker_expr = details;
                        }
                        
                        columnsCfg[colName] = colCfg;
                    });
                    
                    tablesConfig[tableName] = {
                        rows: rowsCount,
                        columns: columnsCfg
                    };
                });

                const ddl = ddlInput.value.trim();

                const isLocalOrDifferentPort = window.location.protocol === 'file:' || window.location.port !== '8000';
                const baseUrl = isLocalOrDifferentPort ? 'http://localhost:8000' : '';
                const response = await fetch(`${baseUrl}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ddl, tables_config: tablesConfig })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.detail || 'An error occurred during generation.');
                }

                currentData = data;
                
                renderTabs();
                // Add a "Configure Schema" tab
                const modifyTab = document.createElement('button');
                modifyTab.className = 'tab';
                modifyTab.style.borderColor = 'var(--accent-green)';
                modifyTab.textContent = '⚙️ Configure';
                modifyTab.onclick = () => {
                    renderCustomizationDashboard(schema, columnMap);
                };
                tabsContainer.insertBefore(modifyTab, tabsContainer.firstChild);

                if (tabsContainer.children[1]) {
                    tabsContainer.children[1].click();
                }

            } catch (error) {
                errorMsg.textContent = error.message;
                errorMsg.classList.remove('hidden');
            } finally {
                submitBtn.disabled = false;
                submitText.classList.remove('hidden');
                submitSpinner.classList.add('hidden');
            }
        });
    }

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
