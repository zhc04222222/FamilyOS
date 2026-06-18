import urllib.request
import json

tests = [
    ('/', 'home'),
    ('/records', 'records'),
    ('/pictures', 'gallery'),
    ('/api/events', 'events API'),
    ('/api/pictures', 'pictures API'),
    ('/api/events/calendar', 'calendar API'),
]

for path, name in tests:
    try:
        resp = urllib.request.urlopen('http://localhost:29375' + path, timeout=5)
        code = resp.getcode()
        data = resp.read()
        print(f'  PASS [{code}] {path} ({name}) - {len(data)} bytes')
    except Exception as e:
        print(f'  FAIL {path} ({name}) - {e}')

# Test create event
print('\n--- Testing create event ---')
import urllib.parse
try:
    data = urllib.parse.urlencode({
        'title': 'test+事件',
        'category': 'checkup',
        'start_time': '2026-06-17T10:00:00',
        'content': 'test',
    }).encode()
    req = urllib.request.Request('http://localhost:29375/api/events', data=data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    resp = urllib.request.urlopen(req, timeout=5)
    result = json.loads(resp.read())
    print(f'  Create event: {result}')
    if result.get('success'):
        event_id = result['id']
        # Test status toggle
        data2 = urllib.parse.urlencode({'status': 'done'}).encode()
        req2 = urllib.request.Request(f'http://localhost:29375/api/events/{event_id}/status', data=data2, method='PUT')
        req2.add_header('Content-Type', 'application/x-www-form-urlencoded')
        resp2 = urllib.request.urlopen(req2, timeout=5)
        print(f'  Toggle status: {json.loads(resp2.read())}')
        # Test delete (with cascade)
        req3 = urllib.request.Request(f'http://localhost:29375/api/events/{event_id}', method='DELETE')
        resp3 = urllib.request.urlopen(req3, timeout=5)
        print(f'  Delete event: {json.loads(resp3.read())}')
except Exception as e:
    print(f'  FAIL - {e}')

# Test picture upload
print('\n--- Testing picture upload ---')
try:
    import os
    boundary = '----TestBoundary12345'
    # Create a tiny 1x1 PNG
    png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
    body = b''
    body += f'--{boundary}\r\n'.encode()
    body += b'Content-Disposition: form-data; name="files"; filename="test.png"\r\n'
    body += b'Content-Type: image/png\r\n\r\n'
    body += png_data
    body += b'\r\n'
    body += f'--{boundary}\r\n'.encode()
    body += b'Content-Disposition: form-data; name="category"\r\n\r\n'
    body += b'checkup\r\n'
    body += f'--{boundary}--\r\n'.encode()

    req = urllib.request.Request('http://localhost:29375/api/pictures/upload', data=body, method='POST')
    req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
    resp = urllib.request.urlopen(req, timeout=5)
    result = json.loads(resp.read())
    print(f'  Upload result: {result}')
    if result.get('success') and result.get('results'):
        pic_id = result['results'][0]['id']
        # Delete picture
        req2 = urllib.request.Request(f'http://localhost:29375/api/pictures/{pic_id}', method='DELETE')
        resp2 = urllib.request.urlopen(req2, timeout=5)
        print(f'  Delete picture: {json.loads(resp2.read())}')
except Exception as e:
    print(f'  FAIL - {e}')

print('\nTEST SUITE COMPLETE')