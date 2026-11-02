"""Protocolo de folhas: servidor local sem dependências Python externas."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from email.parser import BytesParser
from email.policy import default
from datetime import datetime
import argparse
import json
import re
import sqlite3
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
MAX_UPLOAD = 20 * 1024 * 1024
FIELDS = ('name', 'company', 'role', 'registration', 'period')


def db():
    conn = sqlite3.connect(DATA / 'protocols.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn


def initialize():
    (DATA / 'files').mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS protocols (
            id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE,
            name TEXT NOT NULL, company TEXT NOT NULL, role TEXT NOT NULL,
            registration TEXT NOT NULL, period TEXT NOT NULL,
            received_by TEXT NOT NULL, notes TEXT NOT NULL,
            created_at TEXT NOT NULL, file_id TEXT NOT NULL)''')


def extract_fields(text):
    # Capture one label up to the next header label, preserving names with spaces.
    labels = r'Empresa|CNPJ|Colaborador|Matrícula|CPF|PIS|Cliente|Cargo|Escala|Período|Posto'
    values = {}
    for line in text.splitlines():
        for match in re.finditer(rf'({labels}):\s*(.*?)(?=\s+(?:{labels}):|$)', line):
            values[match[1]] = match[2].strip()
    return dict(zip(FIELDS, (values.get(label, '') for label in
                            ('Colaborador', 'Empresa', 'Cargo', 'Matrícula', 'Período'))))


class Handler(BaseHTTPRequestHandler):
    def json_response(self, status, value):
        payload = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/protocols':
            with db() as conn:
                rows = conn.execute('SELECT * FROM protocols ORDER BY id DESC').fetchall()
            return self.json_response(200, [dict(row) for row in rows])
        if re.fullmatch(r'/api/files/[a-f0-9]{32}', path):
            target = DATA / 'files' / (path.rsplit('/', 1)[1] + '.pdf')
            if not target.is_file():
                return self.json_response(404, {'error': 'Arquivo não encontrado.'})
            content = target.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Disposition', 'inline; filename="folha.pdf"')
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "sandbox")
            self.end_headers()
            self.wfile.write(content)
            return
        static = {'/': ('index.html', 'text/html; charset=utf-8'),
                  '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                  '/style.css': ('style.css', 'text/css; charset=utf-8')}
        if path not in static:
            return self.json_response(404, {'error': 'Página não encontrada.'})
        filename, mime = static[path]
        content = (ROOT / 'static' / filename).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > MAX_UPLOAD:
                return self.json_response(413, {'error': 'Envie um arquivo de até 20 MB.'})
            if self.path == '/api/extract':
                return self.upload(length)
            if self.path != '/api/protocols':
                return self.json_response(404, {'error': 'Rota não encontrada.'})
            if length > 65536:
                return self.json_response(413, {'error': 'Dados do protocolo muito extensos.'})
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError('Dados inválidos.')
            record = {}
            for field in (*FIELDS, 'received_by', 'notes', 'file_id'):
                value = body.get(field, '')
                if not isinstance(value, str) or len(value) > (2000 if field == 'notes' else 300):
                    raise ValueError('Campo inválido ou muito extenso.')
                record[field] = value.strip()
            if any(not record[f] for f in ('name', 'company', 'role', 'period', 'received_by')):
                raise ValueError('Preencha nome, empresa, função, período e responsável.')
            if record['file_id'] and (not re.fullmatch('[a-f0-9]{32}', record['file_id']) or
                                     not (DATA / 'files' / (record['file_id'] + '.pdf')).is_file()):
                raise ValueError('Anexo inválido. Importe o PDF novamente.')
            now = datetime.now().astimezone()
            with db() as conn:
                cur = conn.execute('''INSERT INTO protocols
                    (name,company,role,registration,period,received_by,notes,created_at,file_id)
                    VALUES (:name,:company,:role,:registration,:period,:received_by,:notes,:created_at,:file_id)''',
                    {**record, 'created_at': now.isoformat()})
                number = f'PRO-{now.year}-{cur.lastrowid:05d}'
                conn.execute('UPDATE protocols SET number=? WHERE id=?', (number, cur.lastrowid))
                result = dict(conn.execute('SELECT * FROM protocols WHERE id=?', (cur.lastrowid,)).fetchone())
            return self.json_response(201, result)
        except (ValueError, json.JSONDecodeError):
            return self.json_response(400, {'error': 'Dados inválidos. Confira os campos obrigatórios e o tamanho dos textos.'})
        except Exception:
            self.log_error('Falha interna ao processar solicitação')
            return self.json_response(500, {'error': 'Não foi possível concluir. Tente novamente.'})

    def upload(self, length):
        ctype = self.headers.get('Content-Type', '')
        if not ctype.startswith('multipart/form-data;'):
            return self.json_response(400, {'error': 'Formato de envio inválido.'})
        message = BytesParser(policy=default).parsebytes(
            ('Content-Type: ' + ctype + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + self.rfile.read(length))
        parts = list(message.iter_parts()) if message.is_multipart() else []
        part = next((p for p in parts if p.get_param('name', header='content-disposition') == 'file'), None)
        content = part.get_payload(decode=True) if part else None
        if not content or not content.startswith(b'%PDF-'):
            return self.json_response(400, {'error': 'Selecione um arquivo PDF válido.'})
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'input.pdf'
            source.write_bytes(content)
            try:
                result = subprocess.run(['pdftotext', '-layout', str(source), '-'],
                                        capture_output=True, timeout=20)
            except FileNotFoundError:
                return self.json_response(503, {'error': 'Leitor PDF indisponível. Instale poppler-utils ou preencha manualmente.'})
            except subprocess.TimeoutExpired:
                return self.json_response(422, {'error': 'A leitura demorou demais. Tente um PDF menor.'})
        if result.returncode:
            return self.json_response(422, {'error': 'Não foi possível ler o PDF. Verifique se está protegido por senha ou corrompido.'})
        fields = extract_fields(result.stdout.decode('utf-8', errors='replace'))
        file_id = uuid.uuid4().hex
        (DATA / 'files' / (file_id + '.pdf')).write_bytes(content)
        self.json_response(200, {'fields': fields, 'file_id': file_id,
                                'warning': '' if all(fields[f] for f in ('name', 'company', 'role')) else
                                'Alguns campos não foram identificados. Confira e preencha manualmente; PDFs escaneados precisam de OCR.'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--host', default='127.0.0.1')
    args = parser.parse_args()
    initialize()
    print(f'Protocolo de folhas iniciado na porta {args.port}', flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
