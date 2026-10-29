import Md from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function MarkdownContent({ text }: { text: string }) {
  return <div className="md"><Md remarkPlugins={[remarkGfm]}>{text}</Md></div>
}
