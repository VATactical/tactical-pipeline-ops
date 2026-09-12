import avatarSheet from '../assets/team-avatars.jpg'

export const teamAvatars = [
  { id: 'crimson', label: 'Crimson', position: '0% 16.667%' },
  { id: 'emerald', label: 'Emerald', position: '33.333% 16.667%' },
  { id: 'gold', label: 'Gold', position: '66.667% 16.667%' },
  { id: 'ice', label: 'Ice', position: '100% 16.667%' },
  { id: 'rose', label: 'Rose', position: '0% 50%' },
  { id: 'midnight', label: 'Midnight', position: '33.333% 50%' },
  { id: 'steel', label: 'Steel', position: '66.667% 50%' },
  { id: 'bronze', label: 'Bronze', position: '100% 50%' },
  { id: 'ruby', label: 'Ruby', position: '0% 83.333%' },
  { id: 'matrix', label: 'Matrix', position: '33.333% 83.333%' },
  { id: 'magma', label: 'Magma', position: '66.667% 83.333%' },
  { id: 'prism', label: 'Prism', position: '100% 83.333%' },
]

const fallbackAvatar = 'steel'

export default function TeamAvatar({ avatarId, size = 'medium', label = 'Avatar' }) {
  const avatar = teamAvatars.find((item) => item.id === avatarId) || teamAvatars.find((item) => item.id === fallbackAvatar)
  return <span className={`team-avatar team-avatar-${size}`} role="img" aria-label={`${label}: ${avatar.label}`}
    style={{ backgroundImage: `url(${avatarSheet})`, backgroundPosition: avatar.position }} />
}
