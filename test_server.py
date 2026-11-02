import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import server


class ProtocolTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.original_data = server.DATA
        server.DATA = Path(cls.temp.name)
        server.initialize()
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.httpd.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()
        server.DATA = cls.original_data
        cls.temp.cleanup()

    def post(self, value):
        request = Request(self.base + '/api/protocols', json.dumps(value).encode(),
                          {'Content-Type': 'application/json'})
        with urlopen(request) as response:
            return response.status, json.load(response)

    def test_extract_layout(self):
        fields = server.extract_fields('''Empresa: EMPRESA EXEMPLO LTDA      CNPJ: 00.000.000/0001-00
Colaborador: ANA EXEMPLO        Matrícula: 123
CPF: 000.000.000-00             PIS: 00000000000
Cliente: UNIDADE UM            Cargo: AUXILIAR ADMINISTRATIVO
Escala: DIURNO                 Período: 01/10/2026 até 31/10/2026''')
        self.assertEqual(fields, {'name': 'ANA EXEMPLO', 'company': 'EMPRESA EXEMPLO LTDA',
                                'role': 'AUXILIAR ADMINISTRATIVO', 'registration': '123',
                                'period': '01/10/2026 até 31/10/2026'})

    def test_empty_extraction_allows_manual_entry(self):
        self.assertTrue(all(not value for value in server.extract_fields('').values()))

    def test_protocol_persists_and_numbers_are_unique(self):
        record = {'name': 'Ana Exemplo', 'company': 'Empresa Exemplo', 'role': 'Assistente',
                  'period': 'Outubro/2026', 'received_by': 'Departamento pessoal'}
        status, first = self.post(record)
        _, second = self.post(record)
        self.assertEqual(status, 201)
        self.assertNotEqual(first['number'], second['number'])
        with urlopen(self.base + '/api/protocols') as response:
            saved = json.load(response)
        self.assertIn(first['id'], [row['id'] for row in saved])
        with server.db() as conn:
            row = conn.execute('SELECT name FROM protocols WHERE id=?', (first['id'],)).fetchone()
        self.assertEqual(row['name'], 'Ana Exemplo')

    def test_required_fields(self):
        with self.assertRaises(HTTPError) as context:
            self.post({'name': 'Nome incompleto'})
        self.assertEqual(context.exception.code, 400)

    def test_invalid_attachment(self):
        with self.assertRaises(HTTPError) as context:
            self.post({'name': 'Ana', 'company': 'Empresa', 'role': 'Cargo', 'period': 'Mês',
                       'received_by': 'RH', 'file_id': '../../arquivo'})
        self.assertEqual(context.exception.code, 400)

    def test_non_pdf_is_rejected(self):
        body = b'--test\r\nContent-Disposition: form-data; name="file"; filename="fake.pdf"\r\nContent-Type: application/pdf\r\n\r\nnot a pdf\r\n--test--\r\n'
        request = Request(self.base + '/api/extract', body,
                          {'Content-Type': 'multipart/form-data; boundary=test'})
        with self.assertRaises(HTTPError) as context:
            urlopen(request)
        self.assertEqual(context.exception.code, 400)

    def test_path_traversal_is_rejected(self):
        with self.assertRaises(HTTPError) as context:
            urlopen(self.base + '/api/files/../../server.py')
        self.assertEqual(context.exception.code, 404)


if __name__ == '__main__':
    unittest.main()
