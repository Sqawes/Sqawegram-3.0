import html
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

RSS_SOURCES = [
    {
        'name': 'Habr',
        'url': 'https://habr.com/ru/rss/articles/?fl=ru',
    },
    {
        'name': 'TechCrunch',
        'url': 'https://techcrunch.com/feed/',
    },
]


def clean_html(value):
    value = value or ''
    value = html.unescape(value)
    value = re.sub(r'<[^>]+>', ' ', value)
    value = re.sub(r'\s+', ' ', value).strip()
    return value[:500]


def child_value(parent, names):
    for child in list(parent):
        tag = child.tag.split('}', 1)[-1].lower()
        if tag in names:
            return ''.join(child.itertext()).strip()
    return ''


def item_value(item, names):
    for elem in item.iter():
        tag = elem.tag.split('}', 1)[-1].lower()
        if tag in names:
            return ''.join(elem.itertext()).strip()
    return ''


def image_from_item(item):
    for elem in item.iter():
        tag = elem.tag.split('}', 1)[-1].lower()
        if tag == 'enclosure':
            url = elem.attrib.get('url')
            if url:
                return url
        if tag == 'content':
            url = elem.attrib.get('url')
            if url:
                return url
    return ''


def parse_feed(source):
    req = urllib.request.Request(
        source['url'],
        headers={'User-Agent': 'Sqawe/0.1 RSS reader'},
    )
    with urllib.request.urlopen(req, timeout=8) as response:
        raw = response.read()

    root = ET.fromstring(raw)
    items = []

    for elem in root.iter():
        tag = elem.tag.split('}', 1)[-1].lower()
        if tag not in {'item', 'entry'}:
            continue

        title = item_value(elem, {'title'})
        link = ''
        for child in elem.iter():
            child_tag = child.tag.split('}', 1)[-1].lower()
            if child_tag == 'link':
                link = child.attrib.get('href', '') or (child.text or '')
                if link:
                    break
        summary = item_value(elem, {'description', 'summary', 'content'})
        published = item_value(elem, {'pubdate', 'published', 'updated', 'date'})
        image = image_from_item(elem)

        if title and link:
            items.append({
                'source': source['name'],
                'source_url': source['url'],
                'title': clean_html(title)[:250],
                'summary': clean_html(summary),
                'link': link.strip(),
                'image_url': image.strip(),
                'published_at': published.strip(),
            })

        if len(items) >= 12:
            break

    return items


def refresh_news():
    all_items = []
    for source in RSS_SOURCES:
        try:
            all_items.extend(parse_feed(source))
        except Exception:
            continue
    return all_items
