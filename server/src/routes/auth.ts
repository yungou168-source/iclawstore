/**
 * Auth API Routes
 */

import { FastifyInstance } from "fastify";

export async function authRoutes(fastify: FastifyInstance) {
  // GitHub OAuth 登录
  fastify.get("/github", async (request, reply) => {
    const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
    githubAuthUrl.searchParams.set("client_id", process.env.AUTH_GITHUB_ID || "");
    githubAuthUrl.searchParams.set("redirect_uri", `${process.env.API_URL}/auth/github/callback`);
    githubAuthUrl.searchParams.set("scope", "read:user user:email");
    
    return reply.redirect(githubAuthUrl.toString());
  });
  
  // GitHub OAuth 回调
  fastify.get("/github/callback", async (request, reply) => {
    const { code, error } = request.query as any;
    
    if (error) {
      return reply.redirect(`/?auth_error=${encodeURIComponent(error)}`);
    }
    
    // 交换访问令牌
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.AUTH_GITHUB_ID,
        client_secret: process.env.AUTH_GITHUB_SECRET,
        code,
      }),
    });
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      return reply.redirect(`/?auth_error=${encodeURIComponent(tokenData.error)}`);
    }
    
    // 获取用户信息
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/json",
      },
    });
    
    const githubUser = await userResponse.json();
    
    // 查找或创建用户
    const { prisma } = fastify;
    let user = await prisma.users.findFirst({
      where: { email: githubUser.email },
    });
    
    if (!user && githubUser.email) {
      // 生成 handle
      const handle = githubUser.login.toLowerCase().replace(/[^a-z0-9]/g, "-");
      let finalHandle = handle;
      let counter = 1;
      
      while (await prisma.users.findFirst({ where: { handle: finalHandle } })) {
        finalHandle = `${handle}-${counter++}`;
      }
      
      user = await prisma.users.create({
        data: {
          name: githubUser.name,
          image: githubUser.avatar_url,
          email: githubUser.email,
          handle: finalHandle,
          displayName: githubUser.name || githubUser.login,
          githubCreatedAt: new Date(githubUser.created_at),
          githubFetchedAt: new Date(),
        },
      });
    }
    
    if (!user) {
      return reply.redirect("/?auth_error=no_email");
    }
    
    // 生成 JWT
    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      handle: user.handle,
      role: user.role,
    });
    
    // 返回到前端
    return reply.redirect(`/?token=${encodeURIComponent(token)}`);
  });
  
  // 获取当前用户
  fastify.get("/me", {
    onRequest: [fastify.authenticate],
  }, async (request: any, reply) => {
    const { prisma } = fastify;
    
    const user = await prisma.users.findUnique({
      where: { id: request.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        handle: true,
        displayName: true,
        image: true,
        role: true,
        trustedPublisher: true,
        createdAt: true,
      },
    });
    
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }
    
    return user;
  });
  
  // 登出
  fastify.post("/logout", async (request, reply) => {
    // JWT 无状态，不需要服务端处理
    return { success: true };
  });
}
