// 创建 link 标签
export function createLinkTag(id: string, href: string, rel: string) {
  let link = document.getElementById(id) as HTMLLinkElement | null
  if (link)
    return
  link = document.createElement('link')
  link.id = id
  link.rel = rel
  link.href = href
  document.head.appendChild(link)
}
